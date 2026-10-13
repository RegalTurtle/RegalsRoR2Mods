import { getUser } from "@/lib/auth";
import { canSeePack } from "@/lib/access";
import { notFound } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ packId: string }> }) {
  const user = await getUser();
  const { packId } = await params;
  if (!user || !canSeePack(user, packId)) notFound();
  return null;
}
