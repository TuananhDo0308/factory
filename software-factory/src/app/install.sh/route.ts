import { type NextRequest, NextResponse } from "next/server";

function getPublicOrigin(request: NextRequest): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const fwdHost = request.headers.get("x-forwarded-host");
  const fwdProto = request.headers.get("x-forwarded-proto") || "https";
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  const host = request.headers.get("host");
  if (host) {
    const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
    return `${proto}://${host}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request);
  const skillsRepo = (process.env.SF_SKILLS_REPO_URL || "").trim();

  const script = `#!/usr/bin/env bash
set -euo pipefail

SF_SERVER_URL="\${SF_SERVER_URL:-${origin}}"
SF_SKILLS_REPO="\${SF_SKILLS_REPO:-${skillsRepo}}"
SF_HOME="\${SF_HOME:-\$HOME/.sf}"
SF_BIN_DIR="\$SF_HOME/bin"

printf "\\n⚡ Software Factory Runner Installer\\n"
printf "   Control Plane: %s\\n\\n" "\$SF_SERVER_URL"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js 22+ is required. Install it from https://nodejs.org or via 'brew install node'." >&2
  exit 1
fi

NODE_MAJOR="\$(node -p 'process.versions.node.split(".")[0]')"
if [ "\$NODE_MAJOR" -lt 22 ]; then
  echo "✗ Node.js 22+ is required (found v\$(node -v)). Please upgrade Node.js first." >&2
  exit 1
fi

mkdir -p "\$SF_BIN_DIR"
echo "→ Downloading sf CLI from \$SF_SERVER_URL/api/cli/sf.ts ..."
curl -fsSL "\$SF_SERVER_URL/api/cli/sf.ts" -o "\$SF_BIN_DIR/sf.ts"
chmod +x "\$SF_BIN_DIR/sf.ts"

cat > "\$SF_BIN_DIR/sf" << 'EOF'
#!/usr/bin/env bash
exec node "\${SF_HOME:-\$HOME/.sf}/bin/sf.ts" "\$@"
EOF
chmod +x "\$SF_BIN_DIR/sf"

echo "✓ Installed sf CLI at \$SF_BIN_DIR/sf"
if [[ ":\$PATH:" != *":\$SF_BIN_DIR:"* ]]; then
  echo "  Tip: add to your shell profile: export PATH=\\"\$HOME/.sf/bin:\\\$PATH\\""
fi

echo ""
SETUP_ARGS=(setup --url "\$SF_SERVER_URL")
if [ -n "\$SF_SKILLS_REPO" ]; then
  SETUP_ARGS+=(--skills-repo "\$SF_SKILLS_REPO")
fi

# Re-attach stdin to /dev/tty when piped from 'curl ... | bash'
if [ ! -t 0 ] && [ -r /dev/tty ]; then
  exec "\$SF_BIN_DIR/sf" "\${SETUP_ARGS[@]}" "\$@" </dev/tty
else
  exec "\$SF_BIN_DIR/sf" "\${SETUP_ARGS[@]}" "\$@"
fi
`;

  return new NextResponse(script, {
    status: 200,
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
