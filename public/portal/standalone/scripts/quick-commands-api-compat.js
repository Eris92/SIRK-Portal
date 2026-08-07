(function () {
    "use strict";

    var core = window.SirkPlatformCore;
    if (!core || typeof core.api !== "function" || core.__sirkQuickCommandsAggregateApi) return;
    core.__sirkQuickCommandsAggregateApi = true;

    var nativeApi = core.api.bind(core);
    core.api = function (moduleName, assetName, options, parameters) {
        if (moduleName !== "commands" || assetName !== "scripts")
            return nativeApi(moduleName, assetName, options, parameters);

        return Promise.all([
            nativeApi("commands", "tree", options, parameters),
            nativeApi("commands", "catalog", options, parameters)
        ]).then(function (values) {
            return {
                ok: true,
                tree: values[0] && values[0].tree || { children: [] },
                catalog: values[1] && values[1].catalog || []
            };
        });
    };
}());
