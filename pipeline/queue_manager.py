import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class Task:
    id: str
    project_path: str
    service_file: str
    spec_file: str
    module_name: str
    profile: str = "nestjs"  # nestjs, flutter, svelte
    status: str = "pending"  # pending, in_progress, completed, failed
    attempts: int = 0
    max_attempts: int = 5
    error_log: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Task":
        # Handle backward compatibility if profile is missing
        if "profile" not in data:
            data["profile"] = "nestjs"
        return cls(**data)


class QueueManager:
    def __init__(self, queue_file_path: Path):
        self.queue_file_path = Path(queue_file_path)

    def load_queue(self) -> List[Task]:
        if not self.queue_file_path.exists():
            return []
        try:
            with open(self.queue_file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return [Task.from_dict(item) for item in data]
        except (json.JSONDecodeError, OSError):
            return []

    def save_queue(self, tasks: List[Task]) -> None:
        self.queue_file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.queue_file_path, "w", encoding="utf-8") as f:
            json.dump([task.to_dict() for task in tasks], f, indent=2, ensure_ascii=False)

    def add_tasks(self, new_tasks: List[Task], reopen_existing: bool = False) -> int:
        existing = self.load_queue()
        existing_by_service = {t.service_file: t for t in existing}

        max_id_num = 0
        for t in existing:
            try:
                num = int(t.id.split("-")[-1])
                if num > max_id_num:
                    max_id_num = num
            except Exception:
                pass

        added_count = 0
        current_id_num = max_id_num
        for task in new_tasks:
            if task.service_file not in existing_by_service:
                current_id_num += 1
                task.id = f"TASK-{current_id_num:03d}"
                existing.append(task)
                existing_by_service[task.service_file] = task
                added_count += 1
            elif reopen_existing and existing_by_service[task.service_file].status != "pending":
                existing_task = existing_by_service[task.service_file]
                existing_task.status = "pending"
                existing_task.attempts = 0
                existing_task.error_log = None
                existing_task.updated_at = datetime.now(timezone.utc).isoformat()
                added_count += 1

        self.save_queue(existing)
        return added_count

    def get_next_pending(self, module_filter: Optional[List[str]] = None) -> Optional[Task]:
        tasks = self.load_queue()
        for task in tasks:
            if task.status == "pending":
                if module_filter and not any(
                    m.lower() in task.module_name.lower() or m.lower() in task.service_file.lower()
                    for m in module_filter
                ):
                    continue
                return task
        return None

    def update_task_status(
        self, task_id: str, status: str, error_log: Optional[str] = None, increment_attempt: bool = False
    ) -> Optional[Task]:
        tasks = self.load_queue()
        updated_task = None
        for task in tasks:
            if task.id == task_id:
                task.status = status
                task.updated_at = datetime.now(timezone.utc).isoformat()
                if error_log is not None:
                    task.error_log = error_log
                if increment_attempt:
                    task.attempts += 1
                updated_task = task
                break

        if updated_task:
            self.save_queue(tasks)
        return updated_task

    def get_summary(self) -> Dict[str, int]:
        tasks = self.load_queue()
        summary = {"total": len(tasks), "pending": 0, "in_progress": 0, "completed": 0, "failed": 0}
        for task in tasks:
            summary[task.status] = summary.get(task.status, 0) + 1
        return summary

    def reset_failed_tasks(self) -> int:
        tasks = self.load_queue()
        reset_count = 0
        for task in tasks:
            if task.status == "failed":
                task.status = "pending"
                task.attempts = 0
                task.error_log = None
                task.max_attempts = 5
                task.updated_at = datetime.now(timezone.utc).isoformat()
                reset_count += 1
        if reset_count > 0:
            self.save_queue(tasks)
        return reset_count

    def clear_pending_tasks(self) -> int:
        tasks = self.load_queue()
        kept = [t for t in tasks if t.status != "pending"]
        removed = len(tasks) - len(kept)
        if removed > 0:
            self.save_queue(kept)
        return removed
