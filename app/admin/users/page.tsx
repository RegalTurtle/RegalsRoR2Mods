import { getUser } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import UserManager from "./user-manager";

export default async function UsersPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") notFound();
  return <UserManager />;
}
