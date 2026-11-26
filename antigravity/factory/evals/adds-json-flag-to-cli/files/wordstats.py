"""Count lines, words and characters in a text file."""
import argparse
import sys


def stats(text):
    return {
        "lines": len(text.splitlines()),
        "words": len(text.split()),
        "chars": len(text),
    }


def format_text(result):
    return "lines: {lines}\nwords: {words}\nchars: {chars}".format(**result)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path")
    args = parser.parse_args(argv)
    try:
        with open(args.path, encoding="utf-8") as handle:
            text = handle.read()
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(format_text(stats(text)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
