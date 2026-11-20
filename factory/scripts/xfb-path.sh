#!/usr/bin/env bash
# Prints the path of the `xfb` command (XS Factory Bench), or nothing when it is
# not installed. Claude Code's shell often lacks ~/.local/bin and ~/bin on its
# PATH (the desktop app does not read .zshrc), so look there too instead of
# skipping the report.
for c in "$(command -v xfb 2>/dev/null)" "$HOME/.local/bin/xfb" "$HOME/bin/xfb" /usr/local/bin/xfb /opt/homebrew/bin/xfb; do
  if [ -n "$c" ] && [ -x "$c" ]; then echo "$c"; exit 0; fi
done
exit 0
