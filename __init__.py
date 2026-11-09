from .magik_extended_lora_loader import MagikExtendedLoraLoader

NODE_CLASS_MAPPINGS = {"MagikExtendedLoraLoader": MagikExtendedLoraLoader}
NODE_DISPLAY_NAME_MAPPINGS = {"MagikExtendedLoraLoader": "Magik Extended Lora Loader"}
WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
