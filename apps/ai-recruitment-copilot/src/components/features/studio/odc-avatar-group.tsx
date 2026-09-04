import type { OdcMemberSummary } from "@arc/shared/hiring-units";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";

export function OdcAvatarGroup({ members }: { members: OdcMemberSummary[] }) {
  if (members.length === 0) {
    return <span className="text-muted-foreground">未设置</span>;
  }

  return (
    <AvatarGroup>
      {members.slice(0, 5).map((member) => (
        <Avatar key={member.memberId} size="sm" title={`${member.name} · ${member.email}`}>
          {member.image ? <AvatarImage alt={member.name} src={member.image} /> : null}
          <AvatarFallback>{member.name.trim().slice(0, 2) || "ODC"}</AvatarFallback>
        </Avatar>
      ))}
      {members.length > 5 ? (
        <AvatarGroupCount title={`另有 ${members.length - 5} 位 ODC`}>
          +{members.length - 5}
        </AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  );
}
