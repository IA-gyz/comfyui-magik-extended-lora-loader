# Magik Extended Lora Loader

A ComfyUI custom node that loads a **stack of LoRAs** in a single node, with a rich
widget UI: per-LoRA enable/export toggles, strength, description and trigger words,
searchable dropdown, drag-to-reorder, cover previews, and server-side stack presets.

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
- Search box above each dropdown — filters the LoRA list by name
- Checkbox per row — enable/disable without removing the row
- **Export** checkbox — include the row in the `export` output string
- Strength field — model strength for that LoRA
- Drag the ⣿ grip — reorder rows (application order follows row order)
- Description / Trigger words textareas — per-LoRA notes; triggers are appended to `text_prompt`
- Cover image — shown when a sidecar image exists next to the LoRA file
  (`<lora name>.png|.jpg|.jpeg|.webp`); click it to open the LoRA's source page
  (reads a sidecar `.url` file containing a `URL=` line)

### Stack presets

Save/load/delete named LoRA stacks with the preset bar at the top of the node.
Presets are stored server-side in
`<ComfyUI>/user/magik_extended_lora_loader/stack_presets.json` (written atomically)
and are shared across workflows and nodes.

## HTTP endpoints

Registered on the ComfyUI server (same auth model as the rest of the ComfyUI API):

- `GET /magik_extended_lora_loader/get_lora_cover?name=<lora>` — sidecar cover image
- `GET /magik_extended_lora_loader/get_lora_link?name=<lora>` — `{"url": ...}` from the sidecar `.url` file
- `GET /magik_extended_lora_loader/stack_presets` — list preset names; `?name=X` — fetch one preset
- `POST /magik_extended_lora_loader/stack_presets` — save/overwrite a preset (`{"name": ..., "preset": {...}}`)
- `DELETE /magik_extended_lora_loader/stack_presets?name=X` — delete a preset

## License

MIT — see [LICENSE](LICENSE).
