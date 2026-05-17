from __future__ import annotations

import json
import shutil
from pathlib import Path

from server import SNAPSHOT_DIR, analyze_pair, connect_db, init_db, now_iso


VSPHERE = Path(r"C:\Users\vaisman\Desktop\vsphere-vm-power-state.csv")
VEEAM = Path(r"C:\Users\vaisman\Desktop\veeam-backups-and-replicas.csv")


def main() -> None:
    init_db()
    if not VSPHERE.exists() or not VEEAM.exists():
        raise SystemExit("Source CSV files are missing on Desktop")

    records, summary = analyze_pair(VSPHERE, VEEAM)
    created_at = now_iso()
    with connect_db() as conn:
        admin = conn.execute("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").fetchone()
        existing = conn.execute(
            "SELECT id FROM snapshots WHERE vsphere_filename = ? AND veeam_filename = ? ORDER BY id DESC LIMIT 1",
            (VSPHERE.name, VEEAM.name),
        ).fetchone()
        if existing:
            snapshot_id = existing["id"]
            conn.execute(
                """
                UPDATE snapshots
                SET title=?, created_at=?, total_vms=?, powered_on=?, powered_off=?,
                    has_backup=?, has_replica=?, off_with_backup=?, off_with_replica=?
                WHERE id=?
                """,
                (
                    "Current vSphere + Veeam",
                    created_at,
                    summary["totalVms"],
                    summary["poweredOn"],
                    summary["poweredOff"],
                    summary["hasBackup"],
                    summary["hasReplica"],
                    summary["offWithBackup"],
                    summary["offWithReplica"],
                    snapshot_id,
                ),
            )
        else:
            cur = conn.execute(
                """
                INSERT INTO snapshots(
                    title, created_at, uploaded_by, vsphere_filename, veeam_filename,
                    total_vms, powered_on, powered_off, has_backup, has_replica, off_with_backup, off_with_replica
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "Current vSphere + Veeam",
                    created_at,
                    admin["id"],
                    VSPHERE.name,
                    VEEAM.name,
                    summary["totalVms"],
                    summary["poweredOn"],
                    summary["poweredOff"],
                    summary["hasBackup"],
                    summary["hasReplica"],
                    summary["offWithBackup"],
                    summary["offWithReplica"],
                ),
            )
            snapshot_id = cur.lastrowid

    target = SNAPSHOT_DIR / str(snapshot_id)
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(VSPHERE, target / "vsphere.csv")
    shutil.copy2(VEEAM, target / "veeam.csv")
    (target / "analysis.json").write_text(
        json.dumps({"records": records, "summary": summary}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"SNAPSHOT_ID={snapshot_id}")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
