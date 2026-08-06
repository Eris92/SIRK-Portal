(function () {
    "use strict";

    if (window.__sirkCentralDesktopLongPollGuard === true ||
        typeof window.fetch !== "function") return;

    var originalFetch = window.fetch.bind(window);
    var maximumWaitMilliseconds = 15000;
    var gatewayRetryMilliseconds = 1200;

    function frameEndpoint(input) {
        try {
            var value = input instanceof Request ? input.url : String(input == null ? "" : input);
            var endpoint = new URL(value, window.location.href);
            return /^\/connect\/[^/]+\/api\/v1\/desktop\/frame$/i.test(endpoint.pathname)
                ? endpoint
                : null;
        } catch (error) {
            return null;
        }
    }

    function retryResponse(status) {
        return new Promise(function (resolve) {
            window.setTimeout(function () {
                resolve(new Response(null, {
                    status: 204,
                    headers: {
                        "Cache-Control": "no-store",
                        "X-SIRK-Tunnel-Retry": String(status)
                    }
                }));
            }, gatewayRetryMilliseconds);
        });
    }

    window.fetch = function (input, init) {
        var endpoint = frameEndpoint(input);
        if (!endpoint) return originalFetch(input, init);

        var requestedWait = Number(endpoint.searchParams.get("waitMilliseconds"));
        if (!Number.isFinite(requestedWait) || requestedWait > maximumWaitMilliseconds)
            endpoint.searchParams.set("waitMilliseconds", String(maximumWaitMilliseconds));

        var rewritten = input instanceof Request
            ? new Request(endpoint.href, input)
            : endpoint.href;

        return originalFetch(rewritten, init).then(function (response) {
            return response.status === 502 || response.status === 503 || response.status === 504
                ? retryResponse(response.status)
                : response;
        });
    };

    window.__sirkCentralDesktopLongPollGuard = true;
}());
