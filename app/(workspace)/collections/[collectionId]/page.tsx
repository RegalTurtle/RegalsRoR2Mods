import { getUser } from "@/lib/auth";
import { canSeeGroup } from "@/lib/access";
import { notFound } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ collectionId: string }> }) {
  const user = await getUser();
  const { collectionId } = await params;
  if (!user || !canSeeGroup(user, collectionId)) notFound();
  return null;
}
