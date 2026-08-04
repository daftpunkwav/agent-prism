"""Arena 冒烟：加载页、运行、检查 Trace / 对话历史 UI。"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent / "_smoke_artifacts"
OUT.mkdir(exist_ok=True)
BASE = "http://127.0.0.1:3000"


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)

        page.goto(f"{BASE}/arena", wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_load_state("networkidle", timeout=60_000)
        page.screenshot(path=str(OUT / "01-arena.png"), full_page=True)

        # 等待配置加载
        page.get_by_role("textbox", name="实验问题").wait_for(timeout=30_000)
        run_btn = page.get_by_role("button", name="运行")
        assert run_btn.is_disabled(), "空问题时运行按钮应禁用"

        page.get_by_role("textbox", name="实验问题").fill("用一句话回答：1+1等于几？")
        assert run_btn.is_enabled(), "有问题时运行按钮应启用"
        run_btn.click()

        # 等待至少一列出现内容或停止按钮出现
        page.wait_for_timeout(2000)
        page.screenshot(path=str(OUT / "02-running.png"), full_page=True)

        # 最多等 90s 看结果
        deadline_ok = False
        for _ in range(45):
            page.wait_for_timeout(2000)
            cards = page.locator(".column-card").all()
            texts = [c.inner_text()[:200] for c in cards]
            segs = page.locator(".trace-seg").count()
            if segs > 0 or any("OK" in t or "1+1" in t or "等于" in t or "2" in t for t in texts):
                deadline_ok = True
                break
            # Next.js 可能有空 alert；仅非空文案才算失败
            for i in range(page.get_by_role("alert").count()):
                alert = page.get_by_role("alert").nth(i).inner_text().strip()
                if alert:
                    errors.append(f"alert: {alert}")
                    deadline_ok = False
                    break
            else:
                continue
            break

        page.screenshot(path=str(OUT / "03-after-run.png"), full_page=True)
        if not deadline_ok:
            errors.append("运行后未见 Trace 片段或完成态")

        # Guide / Learn 路由
        page.goto(f"{BASE}/guide", wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_load_state("networkidle", timeout=60_000)
        body = page.locator("body").inner_text()
        if "多轮" not in body:
            errors.append("guide 页未出现「多轮」文案")
        page.screenshot(path=str(OUT / "04-guide.png"), full_page=True)

        page.goto(f"{BASE}/learn", wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_load_state("networkidle", timeout=60_000)
        body = page.locator("body").inner_text()
        if "八周" not in body and "多轮对话" not in body:
            errors.append("learn 页未出现八周/多轮文案")
        page.screenshot(path=str(OUT / "05-learn.png"), full_page=True)

        browser.close()

    # 过滤无关噪音
    noise = re.compile(r"Download the React DevTools|Fast Refresh|HMR")
    real = [e for e in errors if not noise.search(e)]
    print("ERRORS:" if real else "OK")
    for e in real:
        print("-", e)
    return 1 if real else 0


if __name__ == "__main__":
    sys.exit(main())
