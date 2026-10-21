from pathlib import Path
from typing import Dict, List, Optional
from pipeline.profiles.base_profile import ProjectProfile
from pipeline.profiles.flutter import FlutterProfile
from pipeline.profiles.nestjs import NestJSProfile
from pipeline.profiles.svelte import SvelteProfile


class ProfileRegistry:
    def __init__(self):
        self._profiles: Dict[str, ProjectProfile] = {
            "nestjs": NestJSProfile(),
            "flutter": FlutterProfile(),
            "svelte": SvelteProfile(),
        }

    def get_profile_by_name(self, name: str) -> Optional[ProjectProfile]:
        return self._profiles.get(name.lower())

    def detect_profile(self, project_path: Path) -> ProjectProfile:
        path = Path(project_path).resolve()
        for profile in self._profiles.values():
            if profile.is_applicable(path):
                return profile
        # Default fallback to NestJS if detection is inconclusive
        return self._profiles["nestjs"]

    def list_available_profiles(self) -> List[str]:
        return list(self._profiles.keys())


registry = ProfileRegistry()
