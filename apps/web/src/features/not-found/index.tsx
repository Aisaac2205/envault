import { Link } from "react-router-dom";
import { FileQuestionMark } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { buttonVariants } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { PageHeader } from "@/shared/ui/page-header";

export default function NotFound() {
  const { t } = useTranslation("notFound");

  return (
    <div className="space-y-8 p-4 sm:p-6 lg:p-8">
      <PageHeader title={t("page.title")} />
      <EmptyState
        icon={<FileQuestionMark />}
        title={t("empty.title")}
        description={t("empty.description")}
        action={
          <Link to="/" className={cn(buttonVariants())}>
            {t("action.home")}
          </Link>
        }
      />
    </div>
  );
}
