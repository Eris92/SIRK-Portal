using System.Text.Json;

namespace Sirk.Portal.Central;

internal static class CentralConnectionMaintenanceCommand
{
    private const string Command = "--central-config";

    public static bool IsRequested(string[] arguments) =>
        arguments.Length > 0 &&
        string.Equals(arguments[0], Command, StringComparison.Ordinal);

    public static Task<int> RunAsync(
        string[] arguments,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        try
        {
            return Task.FromResult(Run(arguments));
        }
        catch (OperationCanceledException)
        {
            return Task.FromResult(130);
        }
        catch (UnauthorizedAccessException exception)
        {
            Console.Error.WriteLine($"Access denied: {exception.Message}");
            return Task.FromResult(77);
        }
        catch (InvalidDataException exception)
        {
            Console.Error.WriteLine($"Invalid Central connection data: {exception.Message}");
            return Task.FromResult(65);
        }
        catch (JsonException exception)
        {
            Console.Error.WriteLine($"Invalid Central connection JSON: {exception.Message}");
            return Task.FromResult(65);
        }
        catch (IOException exception)
        {
            Console.Error.WriteLine($"Central connection I/O error: {exception.Message}");
            return Task.FromResult(74);
        }
        catch (ArgumentException exception)
        {
            Console.Error.WriteLine($"Invalid argument: {exception.Message}");
            return Task.FromResult(64);
        }
    }

    private static int Run(string[] arguments)
    {
        if (arguments.Length < 2)
        {
            PrintUsage();
            return 64;
        }

        return arguments[1] switch
        {
            "validate" => Validate(arguments),
            "import" => Import(arguments),
            "show" => Show(arguments),
            "remove" => Remove(arguments),
            _ => InvalidOperation(arguments[1])
        };
    }

    private static int Validate(string[] arguments)
    {
        if (arguments.Length != 3)
        {
            PrintUsage();
            return 64;
        }

        var document = CentralConnectionResolver.ReadProtectedDocument(arguments[2]);
        WriteRedacted(document);
        Console.WriteLine("Central connection document is valid.");
        return 0;
    }

    private static int Import(string[] arguments)
    {
        if (arguments.Length is < 3 or > 5)
        {
            PrintUsage();
            return 64;
        }

        var sourcePath = arguments[2];
        var consumeSource = arguments.Skip(3)
            .Any(value => string.Equals(value, "--consume", StringComparison.Ordinal));
        var destinationArguments = arguments.Skip(3)
            .Where(value => !string.Equals(value, "--consume", StringComparison.Ordinal))
            .ToArray();
        if (destinationArguments.Length > 1)
        {
            PrintUsage();
            return 64;
        }

        var destinationPath = destinationArguments.Length == 1
            ? CentralConnectionResolver.ResolveConnectionFilePath(destinationArguments[0])
            : CentralConnectionResolver.ResolveConnectionFilePath(string.Empty);
        var document = CentralConnectionResolver.ImportProtectedDocument(
            sourcePath,
            destinationPath,
            consumeSource);

        WriteRedacted(document);
        Console.WriteLine($"Central connection imported to: {destinationPath}");
        return 0;
    }

    private static int Show(string[] arguments)
    {
        if (arguments.Length > 3)
        {
            PrintUsage();
            return 64;
        }

        var path = arguments.Length == 3
            ? CentralConnectionResolver.ResolveConnectionFilePath(arguments[2])
            : CentralConnectionResolver.ResolveConnectionFilePath(string.Empty);
        var document = CentralConnectionResolver.ReadProtectedDocument(path);
        WriteRedacted(document);
        return 0;
    }

    private static int Remove(string[] arguments)
    {
        if (arguments.Length > 3)
        {
            PrintUsage();
            return 64;
        }

        var path = arguments.Length == 3
            ? CentralConnectionResolver.ResolveConnectionFilePath(arguments[2])
            : CentralConnectionResolver.ResolveConnectionFilePath(string.Empty);
        var removed = CentralConnectionResolver.RemoveProtectedDocument(path);
        Console.WriteLine(removed
            ? $"Central connection removed: {path}"
            : $"Central connection was not configured: {path}");
        return 0;
    }

    private static void WriteRedacted(CentralConnectionFileDocument document)
    {
        var redacted = CentralConnectionResolver.Redact(document);
        Console.WriteLine(JsonSerializer.Serialize(
            redacted,
            CentralConnectionFileJsonContext.Default.RedactedCentralConnection));
    }

    private static int InvalidOperation(string operation)
    {
        Console.Error.WriteLine($"Unsupported Central connection operation: {operation}");
        PrintUsage();
        return 64;
    }

    private static void PrintUsage()
    {
        Console.Error.WriteLine(
            "Usage:\n" +
            "  --central-config validate <source-json>\n" +
            "  --central-config import <source-json> [destination-json] [--consume]\n" +
            "  --central-config show [destination-json]\n" +
            "  --central-config remove [destination-json]");
    }
}
