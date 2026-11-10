// Cloned from the user-supplied multi-LoRA frontend.
// Resolve from ComfyUI's extension mount, whether this file is served directly
// from WEB_DIRECTORY or from its nested js/ directory in an existing node pack.
const moduleURL = new URL(import.meta.url);
const extensionMount = moduleURL.pathname.lastIndexOf("/extensions/");
if (extensionMount < 0) {
    throw new Error("Magik Extended Lora Loader: expected a ComfyUI extension URL.");
}
const comfyRoot = moduleURL.pathname.slice(0, extensionMount);
const [{ app }, { api }] = await Promise.all([
    import(`${comfyRoot}/scripts/app.js`),
    import(`${comfyRoot}/scripts/api.js`),
]);

app.registerExtension({
    name: "Magik.ExtendedLoraLoader",

    async nodeCreated(node) {
        if (node.comfyClass !== "MagikExtendedLoraLoader") return;
        if (node.__multiLoraInitialized) return;

        node.__multiLoraInitialized = true;

        const createEmptyEntry = () => ({
            enabled: true,
            export: true,  // New field for export control
            lora_name: "",
            strength_model: 1.0,
            description: "",
            triggers: "",
        });

        const normalizeEntry = (entry) => {
            const strength = parseFloat(entry?.strength_model);

            const result = {
                enabled: entry?.enabled !== false,
                export: entry?.export !== false,  // New field for export control
                lora_name: typeof entry?.lora_name === "string" ? entry.lora_name : "",
                strength_model: Number.isFinite(strength) ? strength : 1.0,
                description: typeof entry?.description === "string" ? entry.description : "",
                triggers: typeof entry?.triggers === "string" ? entry.triggers : "",
            };

            if (typeof entry?.desc_height === "number" && entry.desc_height > 0) {
                result.desc_height = entry.desc_height;
            }

            if (typeof entry?.trig_height === "number" && entry.trig_height > 0) {
                result.trig_height = entry.trig_height;
            }

            return result;
        };

        if (!node.properties) node.properties = {};

        if (node.properties.custom_width === undefined) {
            node.properties.custom_width = 680;
        }

        if (node.properties.custom_height === undefined) {
            node.properties.custom_height = 480;
        }

        if (node.properties.multi_description === undefined) {
            node.properties.multi_description = "";
        }

        if (!Array.isArray(node.properties.multi_loras) || node.properties.multi_loras.length === 0) {
            node.properties.multi_loras = [createEmptyEntry()];
        } else {
            node.properties.multi_loras = node.properties.multi_loras.map(normalizeEntry);
        }

        node.size = [node.properties.custom_width, node.properties.custom_height];

        const MIN_NODE_HEIGHT = 320;

        let loraOptions = [""];

        let autoSizeLock = false;
        let comboWidget = null;
        let syncedOnce = false;
        let lastWidgetVisible = null;

        let listWidget = node.widgets?.find((w) => w.name === "lora_list");

        if (!listWidget) {
            listWidget = node.addWidget("text", "lora_list", "[]", null, {});
        }

        listWidget.hidden = true;
        listWidget.serialize = true;

        if (listWidget.computeSize) {
            listWidget.computeSize = () => [0, 0];
        }

        const templateWidget =
            node.widgets?.find((w) => w.name === "lora_template") || null;

        if (templateWidget?.options?.values?.length) {
            loraOptions = [...templateWidget.options.values];

            if (!loraOptions.includes("")) {
                loraOptions.unshift("");
            }
        }

        function styleControl(el) {
            el.style.backgroundColor = "#1c1c1c";
            el.style.color = "#fff";
            el.style.border = "1px solid #444";
            el.style.borderRadius = "4px";
            el.style.padding = "3px 4px";
            el.style.fontFamily = "sans-serif";
            el.style.fontSize = "10px";
            el.style.lineHeight = "1.3";
            el.style.boxSizing = "border-box";
        }

        function styleSearchInput(el) {
            el.style.backgroundColor = "#2c2c2c";
            el.style.color = "#fff";
            el.style.border = "1px solid #555";
            el.style.borderRadius = "4px";
            el.style.padding = "3px 4px";
            el.style.fontFamily = "sans-serif";
            el.style.fontSize = "10px";
            el.style.lineHeight = "1.3";
            el.style.boxSizing = "border-box";
            el.style.marginBottom = "4px";
        }

        function styleButton(el) {
            el.style.backgroundColor = "#2b2b2b";
            el.style.color = "#ddd";
            el.style.border = "1px solid #555";
            el.style.borderRadius = "4px";
            el.style.cursor = "pointer";
            el.style.padding = "3px 8px";
            el.style.fontSize = "10px";
            el.style.boxSizing = "border-box";
        }

        function styleSmallBtn(el) {
            el.style.backgroundColor = "#2b2b2b";
            el.style.color = "#ddd";
            el.style.border = "1px solid #555";
            el.style.borderRadius = "4px";
            el.style.cursor = "pointer";
            el.style.padding = "3px 0";
            el.style.fontSize = "10px";
            el.style.width = "24px";
            el.style.flexShrink = "0";
            el.style.boxSizing = "border-box";
            el.style.textAlign = "center";
        }

        function fitTextarea(el, minHeight, maxHeight) {
            if (!el) return;

            el.style.height = "auto";

            let h = el.scrollHeight || minHeight;

            if (h < minHeight) h = minHeight;
            if (h > maxHeight) h = maxHeight;

            el.style.height = `${h}px`;
            el.style.overflowY = "auto";
        }

        const root = document.createElement("div");
        root.style.display = "flex";
        root.style.flexDirection = "column";
        root.style.gap = "8px";
        root.style.width = "100%";
        root.style.boxSizing = "border-box";
        root.style.padding = "6px 0";
        root.style.fontFamily = "sans-serif";
        root.style.fontSize = "10px";
        root.style.color = "#ddd";
        root.style.overflowX = "hidden";
        root.style.overflowY = "auto";

        const descArea = document.createElement("textarea");
        descArea.placeholder = "Common description...";
        descArea.value = node.properties.multi_description || "";
        styleControl(descArea);
        descArea.style.resize = "vertical";
        descArea.style.width = "100%";
        descArea.style.minHeight = "30px";
        descArea.style.overflowY = "auto";
        descArea.style.height = "52px";

        const toolbar = document.createElement("div");
        toolbar.style.display = "flex";
        toolbar.style.gap = "6px";
        toolbar.style.alignItems = "center";
        toolbar.style.flexWrap = "wrap";

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.textContent = "+ Add LoRA";
        styleButton(addBtn);

        const refreshBtn = document.createElement("button");
        refreshBtn.type = "button";
        refreshBtn.textContent = "Refresh LoRA list";
        styleButton(refreshBtn);

        const presetBar = document.createElement("div");
        presetBar.style.display = "flex";
        presetBar.style.gap = "6px";
        presetBar.style.alignItems = "center";
        presetBar.style.flexWrap = "wrap";

        const stackPresetSelect = document.createElement("select");
        styleControl(stackPresetSelect);
        stackPresetSelect.title = "Saved LoRA stack presets";
        stackPresetSelect.style.flex = "1";
        stackPresetSelect.style.minWidth = "140px";

        const loadPresetBtn = document.createElement("button");
        loadPresetBtn.type = "button";
        loadPresetBtn.textContent = "Load preset";
        loadPresetBtn.title = "Replace the current stack with the selected preset";
        styleButton(loadPresetBtn);

        const savePresetBtn = document.createElement("button");
        savePresetBtn.type = "button";
        savePresetBtn.textContent = "Save preset";
        savePresetBtn.title = "Save the current stack as a preset";
        styleButton(savePresetBtn);

        const deletePresetBtn = document.createElement("button");
        deletePresetBtn.type = "button";
        deletePresetBtn.textContent = "Delete preset";
        deletePresetBtn.title = "Delete the selected preset";
        styleButton(deletePresetBtn);

        presetBar.appendChild(stackPresetSelect);
        presetBar.appendChild(loadPresetBtn);
        presetBar.appendChild(savePresetBtn);
        presetBar.appendChild(deletePresetBtn);

        const list = document.createElement("div");
        list.style.display = "flex";
        list.style.flexDirection = "column";
        list.style.gap = "6px";

        root.appendChild(descArea);
        root.appendChild(presetBar);

        toolbar.appendChild(addBtn);
        toolbar.appendChild(refreshBtn);

        root.appendChild(toolbar);
        root.appendChild(list);

        comboWidget = node.addDOMWidget(
            "multi_layout",
            "CUSTOM_MULTI_LAYOUT",
            root,
            {
                serialize: false,
            }
        );

        function applySavedDescHeight() {
            const h = node.properties.multi_desc_height;

            if (typeof h === "number" && h > 30) {
                descArea.style.height = `${h}px`;
            }
        }

        function writeHiddenState() {
            if (listWidget) {
                listWidget.value = JSON.stringify(node.properties.multi_loras || []);
            }
        }

        function syncHidden() {
            writeHiddenState();
            node.setDirtyCanvas(true);
        }

        function requestSync() {
            requestAnimationFrame(() => syncHeight());
        }

        function isWidgetVisible() {
            const el = comboWidget?.element;

            if (!el) return false;
            if (!el.offsetParent) return false;
            if (el.offsetHeight === 0) return false;

            return true;
        }

        const textareaMetaMap = new WeakMap();

        const textareaResizeObserver = new ResizeObserver((obsEntries) => {
            if (!isWidgetVisible()) return;

            for (const obsEntry of obsEntries) {
                const el = obsEntry.target;
                const h = el.offsetHeight;

                if (h < 20) continue;

                if (el === descArea) {
                    node.properties.multi_desc_height = h;
                } else {
                    const meta = textareaMetaMap.get(el);

                    if (meta) {
                        meta.entry[meta.key] = h;
                    }
                }
            }

            requestSync();
        });

        textareaResizeObserver.observe(descArea);

        function syncHeight() {
            if (!comboWidget?.element) return;
            if (!isWidgetVisible()) return;

            root.style.height = "auto";

            const contentHeight = Math.max(
                140,
                root.scrollHeight || 0,
                root.offsetHeight || 0
            );

            const topOffset = comboWidget.y || 90;
            const needed = Math.max(
                MIN_NODE_HEIGHT,
                topOffset + contentHeight + 26
            );

            comboWidget.element.style.height = `${contentHeight}px`;
            root.style.height = `${contentHeight}px`;

            if (!autoSizeLock && Math.abs(node.size[1] - needed) > 2) {
                autoSizeLock = true;
                node.setSize([Math.max(520, node.size[0]), needed]);
                autoSizeLock = false;
            }

            node.properties.custom_width = node.size[0];
            node.properties.custom_height = node.size[1];

            node.setDirtyCanvas(true);
        }

        function fillSelect(select, selected) {
            // Clear existing options
            select.innerHTML = "";

            const selectedValue = selected || "";
            const options = [...loraOptions];

            if (selectedValue && !options.includes(selectedValue)) {
                options.push(selectedValue);
            }

            for (const value of options) {
                const opt = document.createElement("option");
                opt.value = value;
                opt.textContent = value === "" ? "(no LoRA)" : value;
                select.appendChild(opt);
            }

            // Set the selected value if available
            select.value = selectedValue;

            // Make sure selection is correctly applied even when it's not in options
            if (select.value !== selectedValue) {
                for (const opt of select.options) {
                    if (opt.value === selectedValue) {
                        select.value = selectedValue;
                        break;
                    }
                }
            }
        }

        function updateCover(img, name) {
            const container = img.parentElement;

            if (!name) {
                if (container) {
                    container.style.display = "none";
                }

                img.removeAttribute("src");
                return;
            }

            const token = Date.now().toString();
            img.dataset.coverToken = token;

            img.onload = () => {
                if (img.dataset.coverToken !== token) return;

                if (container) {
                    container.style.display = "flex";
                }

                img.style.display = "block";
                requestSync();
            };

            img.onerror = () => {
                if (img.dataset.coverToken !== token) return;

                if (container) {
                    container.style.display = "none";
                }

                img.style.display = "none";
                requestSync();
            };

            img.src = api.apiURL(`/magik_extended_lora_loader/get_lora_cover?name=${encodeURIComponent(name)}&t=${token}`);
        }

        function hideServiceWidgets() {
            ["lora_list", "lora_template"].forEach((name) => {
                const w = node.widgets?.find((w) => w.name === name);

                if (w) {
                    w.hidden = true;

                    if (w.computeSize) {
                        w.computeSize = () => [0, 0];
                    }

                    if (w.element) {
                        w.element.style.display = "none";
                    }
                }
            });
        }

        async function fetchLoraOptions() {
            try {
                const response = await api.fetchApi("/object_info/MagikExtendedLoraLoader");
                if (!response.ok) return;

                const data = await response.json();
                const values =
                    data?.MagikExtendedLoraLoader?.input?.required?.lora_template?.[0];

                if (Array.isArray(values) && values.length) {
                    loraOptions = values.includes("") ? [...values] : ["", ...values];

                    if (templateWidget) {
                        templateWidget.options = templateWidget.options || {};
                        templateWidget.options.values = loraOptions;
                    }

                    renderList();
                    syncHidden();
                    requestSync();
                }
            } catch (error) {
                console.error("Failed to refresh LoRA list:", error);
            }
        }

        const DRAG_MIME = "application/x-magik-lora-row";
        let dragIndex = null;

        function clearDropIndicators() {
            for (const child of list.children) {
                child.style.boxShadow = "none";
            }
        }

        function showDropIndicator(row, after) {
            clearDropIndicators();
            row.style.boxShadow = after ? "0 3px 0 0 #4a9eff" : "0 -3px 0 0 #4a9eff";
        }

        function isDropAfter(row, e) {
            const rect = row.getBoundingClientRect();
            return e.clientY > rect.top + rect.height / 2;
        }

        function moveEntry(fromIndex, toIndex) {
            const arr = node.properties.multi_loras;

            if (toIndex < 0 || toIndex >= arr.length) return;

            const item = arr.splice(fromIndex, 1)[0];
            arr.splice(toIndex, 0, item);

            renderList();
            syncHidden();
        }

        function applyRowState(row, entry) {
            if (entry.enabled) {
                row.style.opacity = "1";
                row.style.filter = "none";
                row.style.backgroundColor = "#1a1a1a";
                row.style.border = "1px solid #363636";
            } else {
                row.style.opacity = "0.38";
                row.style.filter = "grayscale(0.85)";
                row.style.backgroundColor = "#0d0d0d";
                row.style.border = "1px solid #222";
            }
        }

        function createRow(entry, index) {
            entry.enabled = entry.enabled !== false;

            entry.lora_name = entry.lora_name || "";

            entry.strength_model = Number.isFinite(parseFloat(entry.strength_model))
                ? parseFloat(entry.strength_model)
                : 1.0;

            entry.description = typeof entry.description === "string"
                ? entry.description
                : "";

            entry.triggers = typeof entry.triggers === "string"
                ? entry.triggers
                : "";

            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.flexDirection = "column";
            row.style.gap = "6px";
            row.style.padding = "6px";
            row.style.borderRadius = "6px";
            row.style.boxSizing = "border-box";

            applyRowState(row, entry);

            const topLine = document.createElement("div");
            topLine.style.display = "flex";
            topLine.style.gap = "4px";
            topLine.style.alignItems = "center";
            topLine.style.flexWrap = "wrap";
            topLine.style.width = "100%";

            const enable = document.createElement("input");
            enable.type = "checkbox";
            enable.checked = entry.enabled;
            enable.title = "Enable/Disable";
            enable.style.cursor = "pointer";
            enable.style.flexShrink = "0";

            // Export checkbox
            const exportCheckbox = document.createElement("input");
            const exportLabel = document.createElement("label");
            exportLabel.style.display = "flex";
            exportLabel.style.alignItems = "center";
            exportLabel.style.gap = "4px";
            exportLabel.style.cursor = "pointer";
            exportCheckbox.type = "checkbox";
            exportCheckbox.checked = entry.export !== false;  // Default to true if not set
            exportCheckbox.title = "Include in Export String";
            exportCheckbox.style.cursor = "pointer";
            exportCheckbox.style.flexShrink = "0";

            exportLabel.appendChild(exportCheckbox);
            exportLabel.appendChild(document.createTextNode("Export"));

            // Create a container for the dropdown with search functionality
            const dropdownContainer = document.createElement("div");
            dropdownContainer.style.display = "flex";
            dropdownContainer.style.flexDirection = "column";
            dropdownContainer.style.gap = "4px";
            dropdownContainer.style.flex = "1";
            dropdownContainer.style.minWidth = "140px";
            
            // Search input field
            const searchInput = document.createElement("input");
            searchInput.type = "text";
            searchInput.placeholder = "Search LoRAs...";
            searchInput.title = "Filter LoRA list by name";
            styleSearchInput(searchInput);
            searchInput.style.width = "100%";
            searchInput.style.marginBottom = "0";
            
            // Dropdown element
            const select = document.createElement("select");
            select.style.flex = "1";
            select.style.minWidth = "140px";
            select.title = "LoRA name";
            styleControl(select);
            
            // Add event listener for search filtering
            searchInput.addEventListener("input", (e) => {
                const searchTerm = e.target.value.toLowerCase();
                const options = select.options;
                const previousValue = select.value;
                
                let firstMatchFound = false;
                
                // Filter dropdown options based on the search term
                for (let i = 0; i < options.length; i++) {
                    const optionText = options[i].textContent.toLowerCase();
                    if (optionText.includes(searchTerm)) {
                        options[i].style.display = "";
                        
                        // Select first match when no selection exists
                        if (!firstMatchFound && searchTerm) {
                            select.value = options[i].value;
                            firstMatchFound = true;
                        }
                    } else {
                        options[i].style.display = "none";
                    }
                }
                
                // If no matches and we had a value, clear selection
                if (!firstMatchFound && searchTerm) {
                    select.selectedIndex = -1;  // Clear selection
                }

                if (select.value !== previousValue) {
                    applySelection();
                }
            });
            
            // Handle when user selects an option from the dropdown
            select.addEventListener("change", (e) => {
                // When user manually selects something, clear search to show full list again
                if (searchInput.value !== "") {
                    searchInput.value = "";
                    
                    // Reset all options to visible - get fresh reference to options
                    const options = select.options;
                    for (let i = 0; i < options.length; i++) {
                        options[i].style.display = "";
                    }
                }
            });
            
            dropdownContainer.appendChild(searchInput);
            dropdownContainer.appendChild(select);

            // Add the container (which includes both search and select) to topLine
            topLine.appendChild(dropdownContainer);

            fillSelect(select, entry.lora_name);

            const strength = document.createElement("input");
            strength.type = "number";
            strength.step = "0.01";
            strength.value = entry.strength_model;
            strength.title = "Strength";
            styleControl(strength);
            strength.style.width = "68px";
            strength.style.flexShrink = "0";

            const grip = document.createElement("div");
            grip.textContent = "⠿";
            grip.title = "Drag to reorder";
            grip.draggable = true;
            grip.style.cursor = "grab";
            grip.style.width = "16px";
            grip.style.flexShrink = "0";
            grip.style.textAlign = "center";
            grip.style.fontSize = "14px";
            grip.style.lineHeight = "1";
            grip.style.color = "#888";
            grip.style.userSelect = "none";

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.textContent = "✕";
            removeBtn.title = "Remove";
            styleSmallBtn(removeBtn);
            removeBtn.style.width = "26px";

            topLine.appendChild(grip);
            topLine.appendChild(enable);
            topLine.appendChild(exportLabel);
            topLine.appendChild(strength);
            topLine.appendChild(removeBtn);

            const contentLine = document.createElement("div");
            contentLine.style.display = "flex";
            contentLine.style.flexDirection = "row";
            contentLine.style.gap = "8px";
            contentLine.style.alignItems = "flex-start";
            contentLine.style.width = "100%";

            const textColumn = document.createElement("div");
            textColumn.style.flex = "1";
            textColumn.style.display = "flex";
            textColumn.style.flexDirection = "column";
            textColumn.style.gap = "4px";
            textColumn.style.minWidth = "0";

            const rowDescArea = document.createElement("textarea");
            rowDescArea.placeholder = "LoRA description...";
            rowDescArea.value = entry.description;
            styleControl(rowDescArea);
            rowDescArea.style.resize = "vertical";
            rowDescArea.style.width = "100%";
            rowDescArea.style.minHeight = "30px";
            rowDescArea.style.overflowY = "auto";

            if (entry.desc_height && entry.desc_height > 30) {
                rowDescArea.style.height = `${entry.desc_height}px`;
            } else {
                rowDescArea.style.height = "58px";
            }

            const rowTrigArea = document.createElement("textarea");
            rowTrigArea.placeholder = "Trigger words...\nOne line or multiple lines.";
            rowTrigArea.value = entry.triggers;
            styleControl(rowTrigArea);
            rowTrigArea.style.resize = "vertical";
            rowTrigArea.style.width = "100%";
            rowTrigArea.style.minHeight = "30px";
            rowTrigArea.style.overflowY = "auto";

            if (entry.trig_height && entry.trig_height > 30) {
                rowTrigArea.style.height = `${entry.trig_height}px`;
            } else {
                rowTrigArea.style.height = "42px";
            }

            textColumn.appendChild(rowDescArea);
            textColumn.appendChild(rowTrigArea);

            const imgContainer = document.createElement("div");
            imgContainer.style.width = "130px";
            imgContainer.style.display = "none";
            imgContainer.style.alignItems = "flex-start";
            imgContainer.style.flexShrink = "0";

            const cover = document.createElement("img");
            cover.style.width = "100%";
            cover.style.height = "auto";
            cover.style.maxHeight = "150px";
            cover.style.objectFit = "contain";
            cover.style.borderRadius = "6px";
            cover.style.border = "1px solid #333";
            cover.style.backgroundColor = "#151515";
            cover.style.cursor = "pointer";
            cover.style.display = "block";
            cover.title = "Click to open source link";

            imgContainer.appendChild(cover);

            contentLine.appendChild(textColumn);
            contentLine.appendChild(imgContainer);

            row.appendChild(topLine);
            row.appendChild(contentLine);

            updateCover(cover, entry.lora_name);

            textareaMetaMap.set(rowDescArea, { entry, key: "desc_height" });
            textareaMetaMap.set(rowTrigArea, { entry, key: "trig_height" });

            textareaResizeObserver.observe(rowDescArea);
            textareaResizeObserver.observe(rowTrigArea);

            cover.addEventListener("click", async (e) => {
                e.stopPropagation();

                const name = select.value;
                if (!name) return;

                try {
                    const response = await api.fetchApi(
                        `/magik_extended_lora_loader/get_lora_link?name=${encodeURIComponent(name)}`
                    );

                    if (response.ok) {
                        const data = await response.json();

                        if (data.url) {
                            if (/^https?:\/\//i.test(data.url)) {
                                window.open(data.url, "_blank", "noopener,noreferrer");
                            }
                        }
                    }
                } catch (error) {
                    console.error("Failed to open LoRA link:", error);
                }
            });

            enable.addEventListener("change", () => {
                entry.enabled = enable.checked;
                renderList();
                syncHidden();
            });

            exportCheckbox.addEventListener("change", () => {
                entry.export = exportCheckbox.checked;
                renderList();
                syncHidden();
            });

            const applySelection = () => {
                entry.lora_name = select.value;
                updateCover(cover, entry.lora_name);
                syncHidden();
            };

            select.addEventListener("change", applySelection);

            strength.addEventListener("input", () => {
                const val = parseFloat(strength.value);

                if (Number.isFinite(val)) {
                    entry.strength_model = val;
                }

                syncHidden();
            });

            grip.addEventListener("dragstart", (e) => {
                dragIndex = index;
                e.dataTransfer.effectAllowed = "move";
                // Firefox refuses to start a drag without setData.
                e.dataTransfer.setData(DRAG_MIME, String(index));

                try {
                    e.dataTransfer.setDragImage(row, 12, 12);
                } catch (err) {
                    // ignore, the browser default drag image is fine
                }

                // Dim after the drag image snapshot has been taken.
                setTimeout(() => {
                    row.style.opacity = "0.5";
                }, 0);
            });

            grip.addEventListener("dragend", () => {
                dragIndex = null;
                clearDropIndicators();
                applyRowState(row, entry);
            });

            row.addEventListener("dragover", (e) => {
                if (dragIndex === null) return;

                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";

                showDropIndicator(row, isDropAfter(row, e));
            });

            row.addEventListener("dragleave", (e) => {
                if (dragIndex === null) return;
                if (e.relatedTarget && row.contains(e.relatedTarget)) return;

                row.style.boxShadow = "none";
            });

            row.addEventListener("drop", (e) => {
                if (dragIndex === null) return;

                e.preventDefault();
                e.stopPropagation();

                const from = dragIndex;
                let target = isDropAfter(row, e) ? index + 1 : index;

                dragIndex = null;
                clearDropIndicators();

                // Removing the dragged item shifts everything after it up by one.
                if (from < target) target -= 1;

                if (target !== from) {
                    moveEntry(from, target);
                }
            });

            rowDescArea.addEventListener("input", () => {
                entry.description = rowDescArea.value;
                syncHidden();
                requestSync();
            });

            rowTrigArea.addEventListener("input", () => {
                entry.triggers = rowTrigArea.value;
                syncHidden();
                requestSync();
            });

            removeBtn.addEventListener("click", () => {
                node.properties.multi_loras.splice(index, 1);
                renderList();
                syncHidden();
            });

            setTimeout(() => {
                if (!entry.desc_height) {
                    fitTextarea(rowDescArea, 58, 160);
                }

                if (!entry.trig_height) {
                    fitTextarea(rowTrigArea, 42, 160);
                }
            }, 0);

            return row;
        }

        function renderList() {
            list.querySelectorAll("textarea").forEach((el) => textareaResizeObserver.unobserve(el));
            list.innerHTML = "";

            node.properties.multi_loras.forEach((entry, index) => {
                list.appendChild(createRow(entry, index));
            });

            requestSync();
        }

        const PRESETS_URL = "/magik_extended_lora_loader/stack_presets";
        let stackPresetNames = [];

        function notify(severity, detail) {
            try {
                app.extensionManager.toast.add({
                    severity,
                    summary: "Magik Extended Lora Loader",
                    detail,
                    life: 4000,
                });
                return;
            } catch (e) {
                // older frontends have no toast API
            }

            if (severity === "error") {
                console.error(`[MagikExtendedLoraLoader] ${detail}`);
                window.alert(detail);
            } else {
                console.warn(`[MagikExtendedLoraLoader] ${detail}`);
            }
        }

        async function readError(response) {
            try {
                const text = await response.text();
                return text || `HTTP ${response.status}`;
            } catch (e) {
                return `HTTP ${response.status}`;
            }
        }

        function setPresetButtonsDisabled(disabled) {
            loadPresetBtn.disabled = disabled;
            savePresetBtn.disabled = disabled;
            deletePresetBtn.disabled = disabled;
        }

        function fillStackPresetSelect(selected) {
            stackPresetSelect.innerHTML = "";

            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = "(select preset)";
            stackPresetSelect.appendChild(placeholder);

            for (const name of stackPresetNames) {
                const opt = document.createElement("option");
                opt.value = name;
                opt.textContent = name;
                stackPresetSelect.appendChild(opt);
            }

            stackPresetSelect.value =
                selected && stackPresetNames.includes(selected) ? selected : "";
        }

        async function fetchStackPresetNames(selected) {
            try {
                const response = await api.fetchApi(PRESETS_URL);

                if (!response.ok) {
                    notify("error", `Failed to list presets: ${await readError(response)}`);
                    return;
                }

                const data = await response.json();

                stackPresetNames = Array.isArray(data?.presets)
                    ? data.presets.map((x) => String(x))
                    : [];

                fillStackPresetSelect(selected ?? stackPresetSelect.value);
            } catch (error) {
                console.error("Failed to list stack presets:", error);
            }
        }

        async function saveStackPreset() {
            const name = (window.prompt("Preset name:", stackPresetSelect.value || "") || "").trim();
            if (!name) return;

            if (stackPresetNames.includes(name) && !window.confirm(`Overwrite preset "${name}"?`)) {
                return;
            }

            setPresetButtonsDisabled(true);

            try {
                const response = await api.fetchApi(PRESETS_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name,
                        preset: {
                            description: node.properties.multi_description || "",
                            loras: node.properties.multi_loras || [],
                        },
                    }),
                });

                if (!response.ok) {
                    notify("error", `Failed to save preset: ${await readError(response)}`);
                    return;
                }

                await fetchStackPresetNames(name);
                notify("success", `Preset "${name}" saved`);
            } catch (error) {
                console.error("Failed to save stack preset:", error);
                notify("error", "Failed to save preset (see console)");
            } finally {
                setPresetButtonsDisabled(false);
            }
        }

        async function loadStackPreset() {
            const name = stackPresetSelect.value;

            if (!name) {
                notify("warn", "Select a preset to load first");
                return;
            }

            setPresetButtonsDisabled(true);

            try {
                const response = await api.fetchApi(
                    `${PRESETS_URL}?name=${encodeURIComponent(name)}`
                );

                if (!response.ok) {
                    notify("error", `Failed to load preset: ${await readError(response)}`);
                    return;
                }

                const data = await response.json();
                const preset = data?.preset;

                if (!preset || !Array.isArray(preset.loras)) {
                    notify("error", `Preset "${name}" is malformed`);
                    return;
                }

                const loras = preset.loras.map(normalizeEntry);

                node.properties.multi_loras = loras.length ? loras : [createEmptyEntry()];
                node.properties.multi_description =
                    typeof preset.description === "string" ? preset.description : "";

                descArea.value = node.properties.multi_description;

                renderList();
                syncHidden();
                requestSync();

                const missing = [
                    ...new Set(
                        loras
                            .map((e) => e.lora_name)
                            .filter((n) => n && !loraOptions.includes(n))
                    ),
                ];

                if (missing.length) {
                    notify("warn", `LoRA file(s) not found: ${missing.join(", ")}`);
                }
            } catch (error) {
                console.error("Failed to load stack preset:", error);
                notify("error", "Failed to load preset (see console)");
            } finally {
                setPresetButtonsDisabled(false);
            }
        }

        async function deleteStackPreset() {
            const name = stackPresetSelect.value;

            if (!name) {
                notify("warn", "Select a preset to delete first");
                return;
            }

            if (!window.confirm(`Delete preset "${name}"?`)) return;

            setPresetButtonsDisabled(true);

            try {
                const response = await api.fetchApi(
                    `${PRESETS_URL}?name=${encodeURIComponent(name)}`,
                    { method: "DELETE" }
                );

                if (!response.ok) {
                    notify("error", `Failed to delete preset: ${await readError(response)}`);
                    return;
                }

                await fetchStackPresetNames("");
            } catch (error) {
                console.error("Failed to delete stack preset:", error);
                notify("error", "Failed to delete preset (see console)");
            } finally {
                setPresetButtonsDisabled(false);
            }
        }

        loadPresetBtn.addEventListener("click", loadStackPreset);
        savePresetBtn.addEventListener("click", saveStackPreset);
        deletePresetBtn.addEventListener("click", deleteStackPreset);

        descArea.addEventListener("input", () => {
            node.properties.multi_description = descArea.value;
            node.setDirtyCanvas(true);
        });

        addBtn.addEventListener("click", () => {
            const arr = node.properties.multi_loras;
            const newEntry = createEmptyEntry();

            if (arr.length > 0) {
                const lastEntry = arr[arr.length - 1];

                if (lastEntry.lora_name) {
                    newEntry.lora_name = lastEntry.lora_name;
                }
            }

            arr.push(newEntry);

            renderList();
            syncHidden();
        });

        refreshBtn.addEventListener("click", async () => {
            refreshBtn.disabled = true;
            await fetchLoraOptions();
            refreshBtn.disabled = false;
        });

        root.addEventListener(
            "wheel",
            (e) => {
                const target = e.target;
                let shouldZoom = true;

                if (target.tagName === "TEXTAREA") {
                    const atTop = target.scrollTop === 0;
                    const atBottom =
                        target.scrollTop + target.clientHeight >=
                        target.scrollHeight - 1;

                    if (e.deltaY < 0 && !atTop) {
                        shouldZoom = false;
                    } else if (e.deltaY > 0 && !atBottom) {
                        shouldZoom = false;
                    }
                }

                if (shouldZoom) {
                    app.canvas.canvas.dispatchEvent(
                        new WheelEvent("wheel", {
                            deltaX: e.deltaX,
                            deltaY: e.deltaY,
                            deltaZ: e.deltaZ,
                            deltaMode: e.deltaMode,
                            ctrlKey: e.ctrlKey,
                            altKey: e.altKey,
                            shiftKey: e.shiftKey,
                            metaKey: e.metaKey,
                            clientX: e.clientX,
                            clientY: e.clientY,
                            screenX: e.screenX,
                            screenY: e.screenY,
                            bubbles: true,
                            cancelable: true,
                        })
                    );

                    e.preventDefault();
                }
            },
            { passive: false }
        );

        let isPanning = false;
        let lastMouseX = 0;
        let lastMouseY = 0;

        root.addEventListener("mousedown", (e) => {
            if (e.button === 1) {
                isPanning = true;
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
                e.preventDefault();
            }
        });

        const onMouseMove = (e) => {
            if (!isPanning) return;

            const deltaX = e.clientX - lastMouseX;
            const deltaY = e.clientY - lastMouseY;

            app.canvas.ds.offset[0] += deltaX / app.canvas.ds.scale;
            app.canvas.ds.offset[1] += deltaY / app.canvas.ds.scale;

            lastMouseX = e.clientX;
            lastMouseY = e.clientY;

            app.canvas.setDirty(true, true);
            e.preventDefault();
        };

        const onMouseUp = (e) => {
            if (isPanning && e.button === 1) {
                isPanning = false;
                e.preventDefault();
            }
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        const oldOnRemoved = node.onRemoved;

        node.onRemoved = function () {
            if (oldOnRemoved) oldOnRemoved.apply(this, arguments);

            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);

            textareaResizeObserver.disconnect();
        };

        const originalComputeSize = node.computeSize;

        node.computeSize = function () {
            const res = originalComputeSize
                ? originalComputeSize.apply(this, arguments)
                : [0, 0];

            if (!Array.isArray(res)) {
                return [node.properties.custom_width, MIN_NODE_HEIGHT];
            }

            if (res[0] < 520) {
                res[0] = Math.max(res[0], 520);
            }

            if (res[1] < MIN_NODE_HEIGHT) {
                res[1] = MIN_NODE_HEIGHT;
            }

            return res;
        };

        const originalOnResize = node.onResize;

        node.onResize = function (size) {
            if (originalOnResize) originalOnResize.apply(this, arguments);

            if (autoSizeLock) return;

            if (size && size[0] && size[1]) {
                if (size[1] < MIN_NODE_HEIGHT) {
                    autoSizeLock = true;
                    size[1] = MIN_NODE_HEIGHT;
                    this.setSize(size);
                    autoSizeLock = false;
                }

                node.properties.custom_width = size[0];
                node.properties.custom_height = size[1];

                requestSync();
            }
        };

        const originalOnDrawForeground = node.onDrawForeground;

        node.onDrawForeground = function (ctx) {
            if (originalOnDrawForeground) {
                originalOnDrawForeground.apply(this, arguments);
            }

            const visible = isWidgetVisible();

            if (!syncedOnce) {
                syncedOnce = true;
                applySavedDescHeight();
                requestSync();
            } else if (visible && lastWidgetVisible === false) {
                applySavedDescHeight();
                requestSync();
            }

            lastWidgetVisible = visible;
        };

        const originalOnConfigure = node.onConfigure;

        node.onConfigure = function () {
            if (originalOnConfigure) {
                originalOnConfigure.apply(this, arguments);
            }

            setTimeout(() => {
                if (listWidget?.value) {
                    try {
                        const parsed = JSON.parse(listWidget.value);

                        if (Array.isArray(parsed)) {
                            node.properties.multi_loras = parsed.map(normalizeEntry);
                        }
                    } catch (e) {
                        // ignore broken JSON
                    }
                }

                if (
                    !Array.isArray(node.properties.multi_loras) ||
                    node.properties.multi_loras.length === 0
                ) {
                    node.properties.multi_loras = [createEmptyEntry()];
                }

                descArea.value = node.properties.multi_description || "";

                applySavedDescHeight();
                hideServiceWidgets();
                renderList();
                syncHidden();
                requestSync();
            }, 100);
        };

        const originalSerialize = node.serialize;

        node.serialize = function () {
            writeHiddenState();

            return originalSerialize
                ? originalSerialize.apply(this, arguments)
                : {};
        };

        setTimeout(async () => {
            hideServiceWidgets();

            if (templateWidget?.options?.values?.length) {
                loraOptions = [...templateWidget.options.values];

                if (!loraOptions.includes("")) {
                    loraOptions.unshift("");
                }
            } else {
                await fetchLoraOptions();
            }

            await fetchStackPresetNames();

            if (
                listWidget?.value &&
                typeof listWidget.value === "string" &&
                listWidget.value.trim() !== "" &&
                listWidget.value.trim() !== "[]"
            ) {
                try {
                    const parsed = JSON.parse(listWidget.value);

                    if (Array.isArray(parsed)) {
                        node.properties.multi_loras = parsed.map(normalizeEntry);
                    }
                } catch (e) {
                    // ignore broken JSON
                }
            }

            if (
                !Array.isArray(node.properties.multi_loras) ||
                node.properties.multi_loras.length === 0
            ) {
                node.properties.multi_loras = [createEmptyEntry()];
            }

            descArea.value = node.properties.multi_description || "";

            applySavedDescHeight();
            renderList();
            syncHidden();
            requestSync();
        }, 250);
    },
});