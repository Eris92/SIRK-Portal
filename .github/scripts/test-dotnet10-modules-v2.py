#!/usr/bin/env python3

import importlib.util
import sys
from pathlib import Path


script_path = Path(__file__).with_name("test-dotnet10-modules.py")
spec = importlib.util.spec_from_file_location("sirk_native_modules_base", script_path)
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load native module E2E base script.")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

original_call = module.Browser.call
optional_modules = {"myjira", "defendertools"}


def call_with_optional_module_enable(self, method, path, payload=None, expected=200):
    if method == "GET" and path.startswith("/api/v1/modules/") and path.endswith("/status"):
        module_name = path.split("/")[4]
        if module_name in optional_modules:
            settings = original_call(self, "GET", "/api/v1/admin/settings")
            current = settings["value"]["modules"][module_name]
            if current.get("enabled") is not True:
                updated = {
                    module_name: {
                        "enabled": True,
                        "accessGroupIds": current.get("accessGroupIds", []),
                        "options": current.get("options", {}),
                    }
                }
                original_call(self, "PUT", "/api/v1/admin/settings", {"modules": updated})
    return original_call(self, method, path, payload, expected)


module.Browser.call = call_with_optional_module_enable

if __name__ == "__main__":
    try:
        raise SystemExit(module.main())
    except Exception as error:  # noqa: BLE001
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
