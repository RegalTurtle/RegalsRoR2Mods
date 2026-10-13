import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import AccountForm from "./account-form";

export default async function AccountPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  return <AccountForm username={user.username} />;
}
