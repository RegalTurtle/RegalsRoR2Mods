import ModWorkspace from "./mod-workspace";
import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  return <ModWorkspace username={user.username} isAdmin={user.role === "admin"}>{children}</ModWorkspace>;
}
