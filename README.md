# Magik Extended Lora Loader

A ComfyUI custom node that loads a **stack of LoRAs** in a single node, with a rich
widget UI: per-LoRA enable toggle, strength and trigger words,
searchable dropdown, drag-to-reorder, multi-image preview strips, and server-side stack presets.

## Install

Clone into ComfyUI's `custom_nodes` directory and restart ComfyUI:

```bash
git clone https://github.com/IA-gyz/comfyui-magik-extended-lora-loader.git ComfyUI/custom_nodes/comfyui-magik-extended-lora-loader
```

No Python dependencies beyond ComfyUI itself (`requirements.txt` is empty).

## Usage

Add the node **Magik Extended Lora Loader** (category `Magik/Loaders`) and wire:

- `model` — the base MODEL to patch
- `text_prompt` — optional STRING input (e.g. from another node); its text is prepended to the output prompt

Outputs:

- `MODEL` — the model with all enabled LoRAs applied in row order
- `text_prompt` — the input prompt followed by each enabled LoRA's trigger words, one per line
- `export` — a compact string of the enabled+exported LoRAs, `name-strength` pairs joined by `_` (e.g. `loraA.safetensors-0.8_loraB.safetensors-1.0`)

In the node widget you can:

- **+ Add LoRA** / **Refresh LoRA list** — append a row / re-read the loras folder
- **Columns** selector — display the LoRA cards in 1–4 columns
- Search box above each dropdown — filters the LoRA list by name
- Checkbox per row — enable/disable without removing the row
- Strength field — model strength for that LoRA; the button row under the LoRA name
  ("0.05", "0.1" … "1.0") sets the strength on click, and **adds** it when Shift is held
- Drag the ⣿ grip — reorder rows (application order follows row order)
- Trigger words textarea, to the right of the strength quick-buttons row — per-LoRA trigger words, appended to `text_prompt`
- Preview strip on the right of each card — all previews for the LoRA shown side by
  side: every custom-uploaded preview first, then every sidecar image next to the LoRA
  file (`<lora name>.png|.jpg|.jpeg|.webp|.gif`), otherwise a placeholder. **Click a
  thumbnail or the `+` cell** to browse the disk and upload another preview image or
  video (max 64 MB each); files are stored in
  `<ComfyUI>/user/magik_extended_lora_loader/previews/` and linked to the LoRA via
  `preview_links.json` in the same folder. The ✕ button removes all custom previews
  (falls back to sidecar/placeholder); 🔗 opens the LoRA's source page
  (reads a sidecar `.url` file containing a `URL=` line). Preview URLs embed a
  per-file version token (mtime+size) and are served with `Cache-Control`, so
  unchanged previews are served from the browser cache instead of being re-downloaded

### Stack presets

Save/load/delete named LoRA stacks with the preset bar at the top of the node.
Presets are stored server-side in
`<ComfyUI>/user/magik_extended_lora_loader/stack_presets.json` (written atomically)
and are shared across workflows and nodes.

## HTTP endpoints

Registered on the ComfyUI server (same auth model as the rest of the ComfyUI API):

- `GET /magik_extended_lora_loader/get_lora_cover?name=<lora>` — sidecar cover image
- `GET /magik_extended_lora_loader/get_lora_link?name=<lora>` — `{"url": ...}` from the sidecar `.url` file
- `GET /magik_extended_lora_loader/get_lora_preview?name=<lora>` — first preview (custom if linked, else sidecar cover); `&index=N` picks the N-th preview; file responses carry `Cache-Control: public, max-age=86400`. `&info=1` returns `{"previews": [{"index", "kind", "custom", "token"}], "kind", "custom"}` where `token` is a per-file version string to pass back as the `t` query param
- `POST /magik_extended_lora_loader/set_lora_preview?name=<lora>` — multipart upload (`file` field) of a preview image/video, saved into the node's `previews/` folder and appended to the LoRA's preview list
- `DELETE /magik_extended_lora_loader/set_lora_preview?name=<lora>` — remove all custom preview links and files for the LoRA
- `GET /magik_extended_lora_loader/stack_presets` — list preset names; `?name=X` — fetch one preset
- `POST /magik_extended_lora_loader/stack_presets` — save/overwrite a preset (`{"name": ..., "preset": {...}}`)
- `DELETE /magik_extended_lora_loader/stack_presets?name=X` — delete a preset

## License

MIT — see [LICENSE](LICENSE).
