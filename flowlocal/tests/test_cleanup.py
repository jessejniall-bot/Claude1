import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flowlocal import cleanup  # noqa: E402


class TestClean(unittest.TestCase):
    def test_collapse_and_capitalize(self):
        self.assertEqual(
            cleanup.clean("  hello   world  "),
            "Hello world",
        )

    def test_space_before_punctuation(self):
        self.assertEqual(cleanup.clean("hello world ."), "Hello world.")

    def test_standalone_i_becomes_capital(self):
        self.assertEqual(cleanup.clean("i think i am right"), "I think I am right")

    def test_multiple_sentences_capitalized(self):
        self.assertEqual(
            cleanup.clean("this is one. that is two."),
            "This is one. That is two.",
        )

    def test_remove_fillers(self):
        self.assertEqual(
            cleanup.clean(
                "um, hello uh there",
                remove_fillers=True,
                filler_words=["um", "uh"],
            ),
            "Hello there",
        )

    def test_fillers_off_by_default(self):
        self.assertEqual(cleanup.clean("um hello"), "Um hello")

    def test_trailing_space(self):
        self.assertEqual(cleanup.clean("hello", trailing_space=True), "Hello ")

    def test_empty(self):
        self.assertEqual(cleanup.clean(""), "")
        self.assertEqual(cleanup.clean("   "), "")

    def test_already_capitalized_untouched(self):
        self.assertEqual(cleanup.clean("Hello there"), "Hello there")


if __name__ == "__main__":
    unittest.main()
