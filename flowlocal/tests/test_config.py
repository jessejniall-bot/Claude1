import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flowlocal import config  # noqa: E402


class TestConfig(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self._prev_appdata = os.environ.get("APPDATA")
        os.environ["APPDATA"] = self._tmp

    def tearDown(self):
        if self._prev_appdata is None:
            os.environ.pop("APPDATA", None)
        else:
            os.environ["APPDATA"] = self._prev_appdata

    def test_defaults_present(self):
        cfg = config.load()
        for key in ("hotkey", "model", "insert_mode", "hotkey_mode"):
            self.assertIn(key, cfg)

    def test_ensure_exists_writes_file(self):
        path = config.ensure_exists()
        self.assertTrue(path.exists())

    def test_user_overrides_win(self):
        config.save({**config.DEFAULTS, "model": "small.en"})
        cfg = config.load()
        self.assertEqual(cfg["model"], "small.en")
        # Unspecified keys still fall back to defaults.
        self.assertEqual(cfg["hotkey"], config.DEFAULTS["hotkey"])

    def test_bad_json_falls_back_to_defaults(self):
        config.config_path().write_text("{ not valid json", encoding="utf-8")
        cfg = config.load()
        self.assertEqual(cfg["model"], config.DEFAULTS["model"])

    def test_partial_config_merges(self):
        config.config_path().write_text(json.dumps({"hotkey": "f9"}), encoding="utf-8")
        cfg = config.load()
        self.assertEqual(cfg["hotkey"], "f9")
        self.assertIn("model", cfg)


if __name__ == "__main__":
    unittest.main()
