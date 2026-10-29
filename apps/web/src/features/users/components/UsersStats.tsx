import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { StatCard } from "@/shared/ui/stat-card";
import { Stagger, StaggerItem } from "@/shared/ui/motion/Stagger";
import { Users, ShieldCheck, UserCheck, UserPlus } from "lucide-react";
import type { User } from "../types";

interface UsersStatsProps {
  users: User[];
  loading?: boolean;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function UsersStats({ users, loading = false }: UsersStatsProps) {
  const { t } = useTranslation("users");
  const total = users.length;
  const admins = users.filter((u) => u.role === "admin").length;
  const active = users.filter((u) => !u.banned).length;
  const [now] = useState(() => Date.now());
  const recent = useMemo(() => {
    const threshold = now - SEVEN_DAYS_MS;
    return users.filter(
      (u) => new Date(u.createdAt).getTime() > threshold,
    ).length;
  }, [users, now]);

  return (
    <Stagger className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StaggerItem className="h-full">
        <StatCard
          variant="outlined"
          label={t("stats.totalUsers")}
          value={total}
          icon={<Users className="h-4 w-4" />}
          loading={loading}
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard
          variant="outlined"
          label={t("stats.admins")}
          value={admins}
          icon={<ShieldCheck className="h-4 w-4" />}
          loading={loading}
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard
          variant="outlined"
          label={t("stats.active")}
          value={active}
          icon={<UserCheck className="h-4 w-4" />}
          loading={loading}
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard
          variant="outlined"
          label={t("stats.recent")}
          value={recent}
          icon={<UserPlus className="h-4 w-4" />}
          loading={loading}
        />
      </StaggerItem>
    </Stagger>
  );
}
