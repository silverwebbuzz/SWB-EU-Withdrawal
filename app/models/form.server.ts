import type { Form, FormVersion, Prisma } from "@prisma/client";
import prisma from "../db.server";
import { defaultWithdrawalFormSchema, parseFormSchema, type FormSchema } from "../lib/form-schema";

export class FormNotFoundError extends Error {
  constructor() {
    super("Form not found");
  }
}

export type FormWithPublished = Form & { publishedVersion: FormVersion | null };

const asJson = (schema: FormSchema) => schema as unknown as Prisma.InputJsonValue;

/** All lookups include shopId so a form ID from another shop never resolves. */
async function findForm(shopId: string, formId: string): Promise<FormWithPublished> {
  const form = await prisma.form.findFirst({
    where: { id: formId, shopId },
    include: { publishedVersion: true },
  });
  if (!form) throw new FormNotFoundError();
  return form;
}

export async function getDefaultForm(shopId: string, defaultFormId: string | null): Promise<FormWithPublished> {
  if (defaultFormId) {
    const form = await prisma.form.findFirst({
      where: { id: defaultFormId, shopId },
      include: { publishedVersion: true },
    });
    if (form) return form;
  }
  const first = await prisma.form.findFirst({
    where: { shopId },
    orderBy: { createdAt: "asc" },
    include: { publishedVersion: true },
  });
  if (!first) throw new FormNotFoundError();
  return first;
}

export async function listVersions(shopId: string, formId: string) {
  return prisma.formVersion.findMany({
    where: { shopId, formId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, createdAt: true },
    take: 20,
  });
}

export type FormMutationResult =
  | { ok: true; form: FormWithPublished }
  | { ok: false; errors: string[] };

function issuesToMessages(issues: { path: PropertyKey[]; message: string }[], schema?: unknown): string[] {
  return issues.map((issue) => {
    const [root, index, ...rest] = issue.path;
    if (root === "fields" && typeof index === "number") {
      const fields = (schema as { fields?: { label?: string; id?: string }[] })?.fields;
      const name = fields?.[index]?.label || fields?.[index]?.id || `#${index + 1}`;
      return `Field "${name}"${rest.length ? ` (${rest.join(".")})` : ""}: ${issue.message}`;
    }
    return issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
  });
}

export async function saveDraft(shopId: string, formId: string, input: unknown): Promise<FormMutationResult> {
  await findForm(shopId, formId);
  const parsed = parseFormSchema(input);
  if (!parsed.success) return { ok: false, errors: issuesToMessages(parsed.error.issues, input) };
  await prisma.form.update({
    where: { id: formId },
    data: { draftSchema: asJson(parsed.data), draftUpdatedAt: new Date(), name: parsed.data.title.slice(0, 190) },
  });
  return { ok: true, form: await findForm(shopId, formId) };
}

/** Publishes the current draft as a new immutable version. */
export async function publishDraft(shopId: string, formId: string): Promise<FormMutationResult> {
  const form = await findForm(shopId, formId);
  const parsed = parseFormSchema(form.draftSchema);
  if (!parsed.success) return { ok: false, errors: issuesToMessages(parsed.error.issues, form.draftSchema) };

  await prisma.$transaction(async (tx) => {
    const latest = await tx.formVersion.findFirst({
      where: { formId, shopId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = await tx.formVersion.create({
      data: { shopId, formId, version: (latest?.version ?? 0) + 1, schema: asJson(parsed.data) },
    });
    await tx.form.update({ where: { id: formId }, data: { publishedVersionId: version.id } });
  });
  return { ok: true, form: await findForm(shopId, formId) };
}

export async function unpublish(shopId: string, formId: string): Promise<FormMutationResult> {
  await findForm(shopId, formId);
  await prisma.form.update({ where: { id: formId }, data: { publishedVersionId: null } });
  return { ok: true, form: await findForm(shopId, formId) };
}

/**
 * Re-publishes the version before the currently published one (or the latest
 * version if the form is unpublished) and loads it into the draft.
 */
export async function restorePreviousVersion(shopId: string, formId: string): Promise<FormMutationResult> {
  const form = await findForm(shopId, formId);
  const current = form.publishedVersion?.version;
  const previous = await prisma.formVersion.findFirst({
    where: { formId, shopId, ...(current ? { version: { lt: current } } : {}) },
    orderBy: { version: "desc" },
  });
  if (!previous) return { ok: false, errors: ["There is no previous published version to restore."] };
  await prisma.form.update({
    where: { id: formId },
    data: {
      publishedVersionId: previous.id,
      draftSchema: previous.schema as Prisma.InputJsonValue,
      draftUpdatedAt: new Date(),
    },
  });
  return { ok: true, form: await findForm(shopId, formId) };
}

/** Replaces the draft with the default template. The live form is unchanged until published. */
export async function resetDraftToDefault(shopId: string, formId: string): Promise<FormMutationResult> {
  await findForm(shopId, formId);
  await prisma.form.update({
    where: { id: formId },
    data: { draftSchema: asJson(defaultWithdrawalFormSchema()), draftUpdatedAt: new Date() },
  });
  return { ok: true, form: await findForm(shopId, formId) };
}

/** The live schema shown on the storefront, or null when unpublished. */
export async function getPublishedForm(shopId: string, defaultFormId: string | null) {
  const form = await getDefaultForm(shopId, defaultFormId).catch((e) => {
    if (e instanceof FormNotFoundError) return null;
    throw e;
  });
  if (!form?.publishedVersion) return null;
  const parsed = parseFormSchema(form.publishedVersion.schema);
  if (!parsed.success) {
    console.error(`[form] Published version ${form.publishedVersion.id} failed validation`);
    return null;
  }
  return { form, version: form.publishedVersion, schema: parsed.data };
}

export async function getFormVersion(shopId: string, versionId: string) {
  const version = await prisma.formVersion.findFirst({ where: { id: versionId, shopId } });
  if (!version) return null;
  const parsed = parseFormSchema(version.schema);
  return parsed.success ? { version, schema: parsed.data } : null;
}
