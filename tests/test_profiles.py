import json
from pathlib import Path
import tempfile
import unittest
from pipeline.profiles.registry import registry
from pipeline.profiles.flutter import FlutterProfile
from pipeline.profiles.nestjs import NestJSProfile
from pipeline.profiles.svelte import SvelteProfile


class TestProfiles(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_detect_flutter_profile(self):
        pubspec = self.base_path / "pubspec.yaml"
        pubspec.write_text("name: test_flutter\n", encoding="utf-8")

        profile = registry.detect_profile(self.base_path)
        self.assertIsInstance(profile, FlutterProfile)
        self.assertEqual(profile.name, "flutter")
        self.assertEqual(profile.get_test_command("test/my_test.dart"), ["flutter", "test", "test/my_test.dart"])

    def test_detect_nestjs_profile(self):
        pkg = self.base_path / "package.json"
        pkg.write_text(json.dumps({"dependencies": {"@nestjs/core": "^10.0.0"}}), encoding="utf-8")

        profile = registry.detect_profile(self.base_path)
        self.assertIsInstance(profile, NestJSProfile)
        self.assertEqual(profile.name, "nestjs")
        self.assertEqual(
            profile.get_test_command("src/my.spec.ts"),
            ["npx", "jest", "--config", "jest.config.json", "src/my.spec.ts"],
        )

    def test_detect_svelte_profile(self):
        svelte_config = self.base_path / "svelte.config.js"
        svelte_config.write_text("export default {};\n", encoding="utf-8")

        profile = registry.detect_profile(self.base_path)
        self.assertIsInstance(profile, SvelteProfile)
        self.assertEqual(profile.name, "svelte")
        self.assertEqual(
            profile.get_test_command("src/my.test.ts"),
            ["npx", "vitest", "run", "src/my.test.ts"],
        )


if __name__ == "__main__":
    unittest.main()
