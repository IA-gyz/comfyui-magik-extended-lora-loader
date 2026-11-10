# Cloned from the user-supplied Extended LoRA Loader.
import json
import logging
import os
import tempfile
import threading

import folder_paths
from aiohttp import web
from nodes import LoraLoaderModelOnly
from server import PromptServer

STACK_PRESETS_FILENAME = "stack_presets.json"
MAX_PRESET_NAME_LENGTH = 100
STACK_PRESETS_LOCK = threading.Lock()


def _stack_presets_path():
    """
    Presets live in the ComfyUI user directory so they survive node updates.
    Falls back to the node folder if the user directory is unavailable.
    """
    try:
        base = folder_paths.get_user_directory()
    except Exception:  # pylint: disable=broad-except
        base = None

    if not base:
        base = os.path.dirname(os.path.abspath(__file__))

    return os.path.join(base, "magik_extended_lora_loader", STACK_PRESETS_FILENAME)


def _is_within_loras_folder(path):
    if not path:
        return False

    real_path = os.path.realpath(path)

    for base in folder_paths.get_folder_paths("loras"):
        real_base = os.path.realpath(base)
        try:
            if os.path.commonpath((real_base, real_path)) == real_base:
                return True
        except ValueError:
            continue

    return False


def load_stack_presets():
    """
    Returns {name: {"description": str, "loras": [entry, ...]}}.
    Raises if the file exists but is corrupt, so a later save can never
    silently overwrite it.
    """
    path = _stack_presets_path()
    if not os.path.exists(path):
        return {}

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise ValueError("stack presets file must contain a JSON object")

    return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, dict)}


def save_stack_presets(presets):
    path = _stack_presets_path()
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(presets, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise


def _clean_preset_name(value):
    name = str(value).strip() if value is not None else ""
    if not name or len(name) > MAX_PRESET_NAME_LENGTH:
        return ""
    return name


def _sanitize_stack_preset(data):
    if not isinstance(data, dict):
        raise ValueError("preset must be an object")

    loras = data.get("loras")
    if not isinstance(loras, list):
        raise ValueError("'loras' must be a list")

    clean_loras = []
    for entry in loras:
        if not isinstance(entry, dict):
            continue

        try:
            strength = float(entry.get("strength_model", 1.0))
        except ValueError:  # pylint: disable=broad-except
            strength = 1.0

        clean_entry = {
            "enabled": entry.get("enabled", True) is not False,
            "export": entry.get("export", True) is not False,
            "lora_name": entry.get("lora_name") if isinstance(entry.get("lora_name"), str) else "",
            "strength_model": strength,
            "description": entry.get("description") if isinstance(entry.get("description"), str) else "",
            "triggers": entry.get("triggers") if isinstance(entry.get("triggers"), str) else "",
        }

        for height_key in ("desc_height", "trig_height"):
            height = entry.get(height_key)
            if isinstance(height, (int, float)) and not isinstance(height, bool) and height > 0:
                clean_entry[height_key] = height

        clean_loras.append(clean_entry)

    description = data.get("description")
    return {
        "description": description if isinstance(description, str) else "",
        "loras": clean_loras,
    }


class MagikExtendedLoraLoader(LoraLoaderModelOnly):
    CATEGORY = "Magik/Loaders"

    @classmethod
    def INPUT_TYPES(s):
        orig_types = LoraLoaderModelOnly.INPUT_TYPES()

        loras = [""]
        try:
            loras += [x for x in folder_paths.get_filename_list("loras") if isinstance(x, str) and x]
        except Exception:  # pylint: disable=broad-except
            pass

        required = {
            "model": orig_types["required"]["model"],
            "lora_template": (loras, {"default": ""}),
            "lora_list": ("STRING", {"default": "[]", "multiline": True}),
        }

        optional = {}
        if "optional" in orig_types:
            optional.update(orig_types["optional"])

        optional["text_prompt"] = ("STRING", {"forceInput": True, "default": ""})

        return {
            "required": required,
            "optional": optional,
        }

    RETURN_TYPES = ("MODEL", "STRING", "STRING")
    RETURN_NAMES = ("MODEL", "text_prompt", "export")
    FUNCTION = "load_lora_multi_extended"

    def _clean_text(self, value):
        value = str(value).strip() if value is not None else ""
        if value in ("[object Object]", "undefined", "null"):
            return ""
        return value

    def _parse_lora_list(self, raw_value):
        if not raw_value:
            return []

        if isinstance(raw_value, list):
            return raw_value

        if isinstance(raw_value, dict):
            return []

        try:
            parsed = json.loads(raw_value)
        except (ValueError, TypeError):  # pylint: disable=broad-except
            return []

        if not isinstance(parsed, list):
            return []

        return parsed

    def _standard_load_lora(self, model, lora_name, strength_model):
        patched_model, _ = super().load_lora(
            model=model,
            clip=None,
            lora_name=lora_name,
            strength_model=strength_model,
            strength_clip=0.0,
        )
        return patched_model

    def load_lora_multi_extended(self, model, lora_template="", lora_list="[]", text_prompt=""):
        current_model = model
        prompt_parts = []
        export_parts = []

        cleaned_prompt = self._clean_text(text_prompt)
        if cleaned_prompt:
            prompt_parts.append(cleaned_prompt)

        entries = self._parse_lora_list(lora_list)

        for entry in entries:
            if not isinstance(entry, dict):
                continue

            enabled = entry.get("enabled", True)
            if isinstance(enabled, str):
                enabled = enabled.strip().lower() not in ("false", "0", "no", "off")

            lora_name = self._clean_text(entry.get("lora_name", ""))
            if not enabled or not lora_name:
                continue

            try:
                strength_model = float(entry.get("strength_model", 1.0))
            except ValueError:  # pylint: disable=broad-except
                strength_model = 1.0

            # Check if this LoRA should be exported - default to True if export field doesn't exist (for backward compatibility)
            export_enabled = entry.get("export", True)
            if isinstance(export_enabled, str):
                export_enabled = export_enabled.strip().lower() not in ("false", "0", "no", "off")

            full_lora_path = folder_paths.get_full_path("loras", lora_name)
            if (
                not full_lora_path
                or not os.path.exists(full_lora_path)
                or not _is_within_loras_folder(full_lora_path)
            ):
                logging.warning("MagikExtendedLoraLoader: skipping missing LoRA: %s", lora_name)
                continue

            current_model = self._standard_load_lora(
                model=current_model,
                lora_name=lora_name,
                strength_model=strength_model,
            )

            triggers = self._clean_text(entry.get("triggers", ""))
            if triggers:
                prompt_parts.append(triggers)

            # Add to export string if enabled
            if export_enabled:
                export_parts.append(f"{lora_name}-{strength_model}")

        return (current_model, "\n".join(prompt_parts), "_".join(export_parts))


@PromptServer.instance.routes.view("/magik_extended_lora_loader/get_lora_cover")
class GetLoraCoverEndpoint(web.View):
    async def get(self):
        lora_name = self.request.query.get("name", "")
        if not lora_name:
            return web.Response(status=400, text="Missing 'name'")

        lora_name = os.path.normpath(lora_name.replace("\\", "/"))
        full_lora_path = folder_paths.get_full_path("loras", lora_name)

        if (
            not full_lora_path
            or not os.path.exists(full_lora_path)
            or not _is_within_loras_folder(full_lora_path)
        ):
            return web.Response(status=404, text="LoRA not found")

        clean_base_path = os.path.splitext(full_lora_path)[0]
        possible_extensions = [".png", ".jpg", ".jpeg", ".webp", ".PNG", ".JPG", ".JPEG", ".WEBP"]

        for ext in possible_extensions:
            img_path = clean_base_path + ext
            if os.path.exists(img_path):
                return web.FileResponse(img_path)

        return web.Response(status=404, text="No cover")


@PromptServer.instance.routes.view("/magik_extended_lora_loader/get_lora_link")
class GetLoraLinkEndpoint(web.View):
    async def get(self):
        lora_name = self.request.query.get("name", "")
        if not lora_name:
            return web.Response(status=400, text="Missing 'name'")

        lora_name = os.path.normpath(lora_name.replace("\\", "/"))
        full_lora_path = folder_paths.get_full_path("loras", lora_name)

        if (
            not full_lora_path
            or not os.path.exists(full_lora_path)
            or not _is_within_loras_folder(full_lora_path)
        ):
            return web.Response(status=404, text="LoRA not found")

        clean_base_path = os.path.splitext(full_lora_path)[0]
        link_extensions = [".url", ".URL"]

        for ext in link_extensions:
            link_path = clean_base_path + ext
            if os.path.exists(link_path):
                try:
                    with open(link_path, "r", encoding="utf-8") as f:
                        content = f.read()

                    for line in content.splitlines():
                        line = line.strip()
                        if line.startswith("URL="):
                            url = line[4:].strip()
                            return web.json_response({"url": url})

                    return web.Response(status=404, text="URL not found in shortcut")
                except Exception as e:
                    return web.Response(status=500, text=f"Error reading shortcut: {str(e)}")

        return web.Response(status=404, text="No shortcut found")


@PromptServer.instance.routes.view("/magik_extended_lora_loader/stack_presets")
class StackPresetsEndpoint(web.View):
    """
    GET              -> {"presets": [names]}
    GET ?name=X      -> {"name": X, "preset": {...}}
    POST {name, preset} -> saves (overwrites) a preset
    DELETE ?name=X   -> removes a preset
    """

    async def get(self):
        try:
            with STACK_PRESETS_LOCK:
                presets = load_stack_presets()
        except Exception as e:
            return web.Response(status=500, text=f"Failed to read presets: {e}")

        name = self.request.query.get("name")
        if name is None:
            return web.json_response({"presets": sorted(presets.keys(), key=str.lower)})

        if name not in presets:
            return web.Response(status=404, text="Preset not found")

        return web.json_response({"name": name, "preset": presets[name]})

    async def post(self):
        try:
            payload = await self.request.json()
        except Exception:
            return web.Response(status=400, text="Invalid JSON body")

        if not isinstance(payload, dict):
            return web.Response(status=400, text="Body must be an object")

        name = _clean_preset_name(payload.get("name"))
        if not name:
            return web.Response(
                status=400,
                text=f"Preset name is required (max {MAX_PRESET_NAME_LENGTH} characters)",
            )

        try:
            preset = _sanitize_stack_preset(payload.get("preset"))
        except ValueError as e:
            return web.Response(status=400, text=str(e))

        try:
            with STACK_PRESETS_LOCK:
                presets = load_stack_presets()
                presets[name] = preset
                save_stack_presets(presets)
        except Exception as e:  # pylint: disable=broad-except
            return web.Response(status=500, text=f"Failed to save preset: {e}")

        return web.json_response({"name": name})

    async def delete(self):
        name = self.request.query.get("name", "")
        if not name:
            return web.Response(status=400, text="Missing 'name'")

        try:
            with STACK_PRESETS_LOCK:
                presets = load_stack_presets()
                if name not in presets:
                    return web.Response(status=404, text="Preset not found")

                del presets[name]
                save_stack_presets(presets)
        except Exception as e:  # pylint: disable=broad-except
            return web.Response(status=500, text=f"Failed to delete preset: {e}")

        return web.json_response({"name": name})
