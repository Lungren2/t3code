import { createFileRoute } from "@tanstack/react-router";

import { PagesPage, type PagesSearch } from "../components/pages/PagesPage";

export const Route = createFileRoute("/_chat/pages")({
  validateSearch: (raw: Record<string, unknown>): PagesSearch => ({
    ...(typeof raw.page === "string" && raw.page.trim() !== ""
      ? { page: raw.page.slice(0, 200) }
      : {}),
    ...(raw.new === true || raw.new === "true" ? { new: true } : {}),
  }),
  component: PagesPage,
});
