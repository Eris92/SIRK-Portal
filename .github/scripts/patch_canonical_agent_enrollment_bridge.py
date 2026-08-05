from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / 'src/Sirk.Portal/Agent/AgentInstallerEnrollmentBridge.cs'
text = path.read_text(encoding='utf-8-sig')
old = '''        if (context.Request.Path.Equals("/api/v1/agent/enroll"))
        {
            await InvokeCanonicalAsync(context);
            return;
        }

        if (context.Request.Path.Equals("/api/agent/v1/enroll"))
        {
            await InvokeSignedAgentV1Async(context);
            return;
        }
'''
new = '''        if (context.Request.Path.Equals("/api/v1/agent/enroll"))
        {
            await InvokeSignedAgentV1Async(context);
            return;
        }
'''
if text.count(old) != 1:
    raise RuntimeError(f'enrollment route block: expected one occurrence, found {text.count(old)}')
text = text.replace(old, new, 1)
start = text.index('    private async Task InvokeCanonicalAsync(HttpContext context)')
end = text.index('    private async Task InvokeSignedAgentV1Async(HttpContext context)', start)
text = text[:start] + text[end:]
if '/api/agent/v1/' in text:
    raise RuntimeError('legacy Agent enrollment route remains')
path.write_text(text, encoding='utf-8', newline='\n')
print('Agent installer enrollment bridge uses canonical ECDSA route.')
