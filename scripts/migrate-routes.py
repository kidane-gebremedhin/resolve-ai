#!/usr/bin/env python3
import re
from pathlib import Path

SRC_ROUTES = Path("/home/kg/Downloads/chat/src/routes")
TARGET_APP = Path("/home/kg/Desktop/Projects/resolve-ai/src/app")

ROUTE_MAP = {
    "index.tsx": "page.tsx",
    "login.tsx": "login/page.tsx",
    "signup.tsx": "signup/page.tsx",
    "features.tsx": "features/page.tsx",
    "contact.tsx": "contact/page.tsx",
    "pricing.tsx": "pricing/page.tsx",
    "customers.tsx": "customers/page.tsx",
    "app.index.tsx": "app/page.tsx",
    "app.chat.tsx": "app/chat/page.tsx",
    "app.inbox.tsx": "app/inbox/page.tsx",
    "app.analytics.tsx": "app/analytics/page.tsx",
    "app.knowledge.tsx": "app/knowledge/page.tsx",
    "app.settings.tsx": "app/settings/page.tsx",
    "app.websites.tsx": "app/websites/page.tsx",
    "app.ai.tsx": "app/ai/page.tsx",
    "app.widget.tsx": "app/widget/page.tsx",
    "app.leads.tsx": "app/leads/page.tsx",
    "app.usage.tsx": "app/usage/page.tsx",
    "app.billing.tsx": "app/billing/page.tsx",
    "admin.index.tsx": "admin/page.tsx",
    "admin.users.tsx": "admin/users/page.tsx",
    "admin.subscribers.tsx": "admin/subscribers/page.tsx",
    "admin.subscriptions.tsx": "admin/subscriptions/page.tsx",
    "admin.analytics.tsx": "admin/analytics/page.tsx",
    "admin.settings.tsx": "admin/settings/page.tsx",
}


def transform(content: str, is_layout: bool = False) -> str:
    content = re.sub(
        r"import \{ createFileRoute[^}]*\} from ['\"]@tanstack/react-router['\"];\n?",
        "",
        content,
    )
    content = re.sub(
        r"import \{ createFileRoute,[^}]*\} from ['\"]@tanstack/react-router['\"];\n?",
        "",
        content,
    )
    content = re.sub(
        r"export const Route = createFileRoute\([^)]*\)\(\{[\s\S]*?\}\);\s*",
        "",
        content,
    )

    if "Link" in content:
        content = re.sub(
            r"import \{([^}]*)\} from ['\"]@tanstack/react-router['\"];",
            lambda m: _fix_link_import(m.group(1)),
            content,
            count=1,
        )
        content = content.replace('to="/', 'href="/')
        content = content.replace("to='/", "href='/")
        content = content.replace('to={', 'href={')

    if "useLocation" in content:
        if "usePathname" not in content:
            content = "import { usePathname } from 'next/navigation';\n" + content
        content = content.replace("useLocation()", "usePathname()")
        content = content.replace(
            "const { pathname } = usePathname()",
            "const pathname = usePathname()",
        )

    content = content.replace("<Outlet />", "{children}")
    content = content.replace("<Outlet/>", "{children}")

    needs_client = (
        bool(
            re.search(
                r"useState|useEffect|useRef|useGSAP|onClick|onSubmit|usePathname",
                content,
            )
        )
        or is_layout
    )
    if needs_client and "'use client'" not in content:
        content = "'use client';\n\n" + content

    for name in ["Page", "Home", "Customers", "AppShell", "AdminShell"]:
        if re.search(rf"function {name}\(", content) and "export default" not in content:
            content += f"\nexport default {name};\n"
            break

    return content.strip() + "\n"


def _fix_link_import(imports: str) -> str:
    parts = [p.strip() for p in imports.split(",") if p.strip()]
    nav_parts = [p for p in parts if p not in ("Link",)]
    lines = ["import Link from 'next/link';"]
    if nav_parts:
        lines.append(f"import {{ {', '.join(nav_parts)} }} from 'next/navigation';")
    return "\n".join(lines) + "\n"


def main() -> None:
    for src_name, dest_rel in ROUTE_MAP.items():
        src = SRC_ROUTES / src_name
        if not src.exists():
            print(f"MISSING {src_name}")
            continue
        out = transform(src.read_text())
        dest = TARGET_APP / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(out)
        print(f"OK {dest_rel}")


if __name__ == "__main__":
    main()
