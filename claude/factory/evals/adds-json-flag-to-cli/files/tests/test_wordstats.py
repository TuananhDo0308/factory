import contextlib
import io
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import wordstats


class Stats(unittest.TestCase):
    def test_counts(self):
        self.assertEqual(wordstats.stats("a b\nc\n"), {"lines": 2, "words": 3, "chars": 6})

    def test_empty(self):
        self.assertEqual(wordstats.stats(""), {"lines": 0, "words": 0, "chars": 0})


class Cli(unittest.TestCase):
    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = wordstats.main(list(argv))
        return code, out.getvalue()

    def test_text_output(self):
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as handle:
            handle.write("a b\nc\n")
        self.addCleanup(os.unlink, handle.name)
        code, out = self.run_cli(handle.name)
        self.assertEqual(code, 0)
        self.assertEqual(out, "lines: 2\nwords: 3\nchars: 6\n")

    def test_missing_file(self):
        code, out = self.run_cli("/nonexistent/file.txt")
        self.assertEqual(code, 1)
        self.assertEqual(out, "")


if __name__ == "__main__":
    unittest.main()
