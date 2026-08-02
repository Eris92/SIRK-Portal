using System.Text.Json;

namespace Sirk.Portal.Settings;

internal static class JsonSerializer
{
    public static JsonElement SerializeToElement(object? value)
    {
        var runtimeType = value?.GetType() ?? typeof(object);
        return System.Text.Json.JsonSerializer.SerializeToElement(value, runtimeType);
    }
}
