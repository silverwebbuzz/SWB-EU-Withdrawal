import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { requireAdmin } from "../lib/admin-context.server";
import {
  getDefaultForm,
  listVersions,
  publishDraft,
  resetDraftToDefault,
  restorePreviousVersion,
  saveDraft,
  unpublish,
  type FormMutationResult,
} from "../models/form.server";
import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  OPTION_FIELD_TYPES,
  SINGLETON_FIELD_TYPES,
  isContentField,
  makeFieldId,
  newField,
  parseFormSchema,
  type FieldType,
  type FormField,
  type FormSchema,
} from "../lib/form-schema";
import { renderFormPage } from "../lib/storefront-render";
import { isLocale } from "../lib/i18n";
import { formatDateTime } from "../lib/timezone";

const val = (e: unknown) => (e as { currentTarget: { value: string } }).currentTarget.value;
const checked = (e: unknown) => (e as { currentTarget: { checked: boolean } }).currentTarget.checked;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, settings, timeZone } = await requireAdmin(request);
  const form = await getDefaultForm(shop.id, settings.defaultFormId);
  const versions = await listVersions(shop.id, form.id);
  return {
    formId: form.id,
    draft: form.draftSchema as unknown as FormSchema,
    draftUpdatedAt: formatDateTime(form.draftUpdatedAt, timeZone),
    draftKey: form.draftUpdatedAt.toISOString(),
    published: form.publishedVersion
      ? { version: form.publishedVersion.version, at: formatDateTime(form.publishedVersion.createdAt, timeZone) }
      : null,
    versions: versions.map((v) => ({ version: v.version, at: formatDateTime(v.createdAt, timeZone) })),
    appearance: {
      accentColor: settings.buttonBgColor,
      accentTextColor: settings.buttonTextColor,
      periodDays: settings.withdrawalPeriodDays,
      periodNote: settings.withdrawalPeriodNote,
    },
    locale: isLocale(settings.defaultLocale) ? settings.defaultLocale : "en",
  };
};

type ActionResult = { ok: true; message: string } | { ok: false; errors: string[] };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, settings } = await requireAdmin(request);
  const form = await getDefaultForm(shop.id, settings.defaultFormId);
  const body = await request.formData();
  const intent = String(body.get("intent") ?? "");

  let result: FormMutationResult;
  let message = "";
  if (intent === "save" || intent === "publish") {
    let schema: unknown;
    try {
      schema = JSON.parse(String(body.get("schema") ?? ""));
    } catch {
      return data<ActionResult>({ ok: false, errors: ["The form data could not be read."] }, { status: 400 });
    }
    result = await saveDraft(shop.id, form.id, schema);
    message = "Draft saved";
    if (result.ok && intent === "publish") {
      result = await publishDraft(shop.id, form.id);
      message = "Form published";
    }
  } else if (intent === "unpublish") {
    result = await unpublish(shop.id, form.id);
    message = "Form unpublished – the storefront form is now unavailable";
  } else if (intent === "restore") {
    result = await restorePreviousVersion(shop.id, form.id);
    message = "Previous version restored and published";
  } else if (intent === "reset") {
    result = await resetDraftToDefault(shop.id, form.id);
    message = "Draft reset to the default template (not yet published)";
  } else {
    return data<ActionResult>({ ok: false, errors: ["Unknown action"] }, { status: 400 });
  }
  return result.ok ? { ok: true, message } : data<ActionResult>({ ok: false, errors: result.errors }, { status: 422 });
};

function FieldEditor({
  field,
  onChange,
}: {
  field: FormField;
  onChange: (patch: Partial<FormField>) => void;
}) {
  const content = isContentField(field);
  const hasOptions = OPTION_FIELD_TYPES.includes(field.type);
  const fixedVisibility = field.type === "hidden" || field.type === "customer_email";
  const textual = ["text", "textarea", "customer_name", "order_reference", "phone"].includes(field.type);

  const setValidation = (key: "minLength" | "maxLength" | "min" | "max", raw: string) => {
    const n = raw === "" ? undefined : Number(raw);
    const next = { ...(field.validation ?? {}), [key]: Number.isFinite(n) ? n : undefined };
    onChange({ validation: next });
  };

  return (
    <s-stack direction="block" gap="base">
      <s-text color="subdued">
        {FIELD_TYPE_LABELS[field.type]} · ID <code>{field.id}</code>
      </s-text>
      {field.type === "paragraph" ? (
        <s-text-area
          label="Text"
          rows={4}
          value={field.helpText ?? ""}
          onInput={(e) => onChange({ helpText: val(e) })}
        />
      ) : (
        <s-text-field
          label={field.type === "heading" ? "Heading text" : "Label"}
          value={field.label}
          onInput={(e) => onChange({ label: val(e) })}
        />
      )}
      {!content ? (
        <>
          {field.type !== "hidden" ? (
            <s-text-field label="Help text" value={field.helpText ?? ""} onInput={(e) => onChange({ helpText: val(e) || undefined })} />
          ) : null}
          {!hasOptions && !["checkbox", "hidden", "date"].includes(field.type) ? (
            <s-text-field label="Placeholder" value={field.placeholder ?? ""} onInput={(e) => onChange({ placeholder: val(e) || undefined })} />
          ) : null}
          <s-text-field
            label={field.type === "hidden" ? "Stored value" : "Default value"}
            details={field.type === "checkbox" ? 'Use "yes" to pre-check' : hasOptions ? "Must match an option value" : undefined}
            value={field.defaultValue ?? ""}
            onInput={(e) => onChange({ defaultValue: val(e) || undefined })}
          />
          {field.type !== "hidden" ? (
            <s-checkbox
              label="Required"
              checked={field.required}
              disabled={field.type === "customer_email"}
              onChange={(e) => onChange({ required: checked(e) })}
            />
          ) : null}
          <s-select
            label="Visibility"
            value={field.visibility}
            disabled={fixedVisibility}
            details="Admin-only fields are never shown to customers; they store their default value on each request."
            onChange={(e) => onChange({ visibility: val(e) as FormField["visibility"] })}
          >
            <s-option value="customer">Visible to customers</s-option>
            <s-option value="admin">Admin only</s-option>
          </s-select>
        </>
      ) : null}

      {hasOptions ? (
        <s-stack direction="block" gap="small-200">
          <s-heading>Options</s-heading>
          {(field.options ?? []).map((o, i) => (
            <s-grid key={i} gridTemplateColumns="1fr 1fr auto" gap="small-200" alignItems="end">
              <s-text-field
                label="Label"
                value={o.label}
                onInput={(e) => {
                  const options = [...(field.options ?? [])];
                  options[i] = { ...o, label: val(e) };
                  onChange({ options });
                }}
              />
              <s-text-field
                label="Value"
                value={o.value}
                onInput={(e) => {
                  const options = [...(field.options ?? [])];
                  options[i] = { ...o, value: val(e).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) };
                  onChange({ options });
                }}
              />
              <s-button
                variant="tertiary"
                icon="delete"
                accessibilityLabel={`Remove option ${o.label}`}
                onClick={() => onChange({ options: (field.options ?? []).filter((_, j) => j !== i) })}
              />
            </s-grid>
          ))}
          <s-stack direction="inline">
            <s-button
              icon="plus"
              onClick={() => {
                const n = (field.options?.length ?? 0) + 1;
                onChange({ options: [...(field.options ?? []), { value: `option_${n}_${Date.now() % 1000}`, label: `Option ${n}` }] });
              }}
            >
              Add option
            </s-button>
          </s-stack>
        </s-stack>
      ) : null}

      {textual ? (
        <s-grid gridTemplateColumns="1fr 1fr" gap="small-200">
          <s-number-field
            label="Min length"
            value={field.validation?.minLength?.toString() ?? ""}
            onInput={(e) => setValidation("minLength", val(e))}
          />
          <s-number-field
            label="Max length"
            value={field.validation?.maxLength?.toString() ?? ""}
            onInput={(e) => setValidation("maxLength", val(e))}
          />
        </s-grid>
      ) : null}
      {field.type === "text" ? (
        <s-select
          label="Allowed characters"
          value={field.validation?.pattern ?? "none"}
          onChange={(e) =>
            onChange({ validation: { ...(field.validation ?? {}), pattern: val(e) as "none" | "alphanumeric" | "digits" } })
          }
        >
          <s-option value="none">Any</s-option>
          <s-option value="alphanumeric">Letters, digits and spaces</s-option>
          <s-option value="digits">Digits only</s-option>
        </s-select>
      ) : null}
      {field.type === "number" ? (
        <s-grid gridTemplateColumns="1fr 1fr" gap="small-200">
          <s-number-field label="Minimum" value={field.validation?.min?.toString() ?? ""} onInput={(e) => setValidation("min", val(e))} />
          <s-number-field label="Maximum" value={field.validation?.max?.toString() ?? ""} onInput={(e) => setValidation("max", val(e))} />
        </s-grid>
      ) : null}
    </s-stack>
  );
}

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

export default function FormBuilder() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const [selectedId, setSelectedId] = useState<string | null>(loaderData.draft.fields[0]?.id ?? null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show(fetcher.data.message);
    else shopify.toast.show("Could not save the form", { isError: true });
  }, [fetcher.state, fetcher.data, shopify]);

  // Remount the editor when the server draft changes (save, restore, reset) so
  // local state always starts from the persisted draft.
  return (
    <FormBuilderEditor
      key={loaderData.draftKey}
      loaderData={loaderData}
      fetcher={fetcher}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
    />
  );
}

function FormBuilderEditor({
  loaderData,
  fetcher,
  selectedId,
  setSelectedId,
}: {
  loaderData: LoaderData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}) {
  const [schema, setSchema] = useState<FormSchema>(loaderData.draft);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(loaderData.draft));
  // A failed save leaves the changes unsaved.
  const dirty = JSON.stringify(schema) !== savedJson || (fetcher.state === "idle" && fetcher.data?.ok === false);
  const [newType, setNewType] = useState<FieldType>("text");
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">("desktop");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const busy = fetcher.state !== "idle";
  const serverErrors = fetcher.state === "idle" && fetcher.data && !fetcher.data.ok ? fetcher.data.errors : [];

  const validation = useMemo(() => parseFormSchema(schema), [schema]);
  const clientErrors = validation.success
    ? []
    : validation.error.issues.slice(0, 8).map((i) => {
        const [root, idx] = i.path;
        const f = root === "fields" && typeof idx === "number" ? schema.fields[idx] : undefined;
        return f ? `${f.label || FIELD_TYPE_LABELS[f.type]}: ${i.message}` : i.message;
      });

  const update = (next: FormSchema) => setSchema(next);
  const updateField = (id: string, patch: Partial<FormField>) =>
    update({ ...schema, fields: schema.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= schema.fields.length || from === to) return;
    const fields = [...schema.fields];
    const [item] = fields.splice(from, 1);
    fields.splice(to, 0, item);
    update({ ...schema, fields });
  };
  const usedSingletons = new Set(schema.fields.map((f) => f.type).filter((t) => SINGLETON_FIELD_TYPES.includes(t)));
  const addField = () => {
    const field = newField(newType, schema.fields.map((f) => f.id));
    update({ ...schema, fields: [...schema.fields, field] });
    setSelectedId(field.id);
  };
  const duplicate = (index: number) => {
    const source = schema.fields[index];
    if (SINGLETON_FIELD_TYPES.includes(source.type)) return;
    const copy = { ...structuredClone(source), id: makeFieldId(source.type, schema.fields.map((f) => f.id)) };
    const fields = [...schema.fields];
    fields.splice(index + 1, 0, copy);
    update({ ...schema, fields });
    setSelectedId(copy.id);
  };
  const remove = (index: number) => {
    const fields = schema.fields.filter((_, i) => i !== index);
    update({ ...schema, fields });
    if (schema.fields[index]?.id === selectedId) setSelectedId(fields[0]?.id ?? null);
  };

  const submit = (intent: string) => {
    if (intent === "save" || intent === "publish") setSavedJson(JSON.stringify(schema));
    fetcher.submit({ intent, schema: JSON.stringify(schema) }, { method: "post" });
  };

  const previewHtml = useMemo(
    () =>
      renderFormPage(
        { schema, formToken: "preview" },
        { locale: loaderData.locale, appearance: loaderData.appearance, preview: true },
      ),
    [schema, loaderData.locale, loaderData.appearance],
  );
  const selected = schema.fields.find((f) => f.id === selectedId) ?? null;

  return (
    <s-page heading="Form Builder" inlineSize="large">
      <s-button slot="primary-action" variant="primary" onClick={() => submit("publish")} disabled={busy || !validation.success}>
        Publish
      </s-button>
      <s-button slot="secondary-actions" onClick={() => submit("save")} disabled={busy || !dirty || !validation.success}>
        Save draft
      </s-button>
      <s-button slot="secondary-actions" commandFor="preview-modal" command="--show">
        Preview
      </s-button>
      <s-button slot="secondary-actions" onClick={() => submit("unpublish")} disabled={busy || !loaderData.published}>
        Unpublish
      </s-button>
      <s-button slot="secondary-actions" onClick={() => submit("restore")} disabled={busy || loaderData.versions.length < 2}>
        Restore previous version
      </s-button>
      <s-button slot="secondary-actions" commandFor="reset-modal" command="--show">
        Reset to default template
      </s-button>

      <s-stack direction="block" gap="base">
        <s-banner tone={loaderData.published ? "success" : "warning"}>
          {loaderData.published
            ? `Live: version ${loaderData.published.version}, published ${loaderData.published.at}.`
            : "This form is unpublished. Customers see an 'unavailable' message until you publish."}
          {dirty ? " You have unsaved changes." : ` Draft last saved ${loaderData.draftUpdatedAt}.`}
        </s-banner>
        {serverErrors.length > 0 || clientErrors.length > 0 ? (
          <s-banner tone="critical" heading="Fix these issues before saving">
            <s-unordered-list>
              {[...new Set([...serverErrors, ...clientErrors])].map((e) => (
                <s-list-item key={e}>{e}</s-list-item>
              ))}
            </s-unordered-list>
          </s-banner>
        ) : null}
        <s-banner tone="info">
          The default template is a starting point and does not by itself guarantee legal compliance. Have your form
          reviewed by qualified counsel.
        </s-banner>
      </s-stack>

      <s-section heading="Form">
        <s-stack direction="block" gap="base">
          <s-text-field label="Title" value={schema.title} onInput={(e) => update({ ...schema, title: val(e) })} />
          <s-text-area
            label="Introduction"
            rows={3}
            value={schema.intro ?? ""}
            onInput={(e) => update({ ...schema, intro: val(e) || undefined })}
          />
          <s-text-field
            label="Confirm button label"
            details="Shown on the review step. Empty uses the translated default (e.g. 'Confirm withdrawal')."
            value={schema.submitLabel ?? ""}
            onInput={(e) => update({ ...schema, submitLabel: val(e) || undefined })}
          />
        </s-stack>
      </s-section>

      <s-section heading={`Fields (${schema.fields.length})`}>
        <s-stack direction="block" gap="small-200">
          {schema.fields.map((f, i) => (
            <div
              key={f.id}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
              }}
              style={{ opacity: dragIndex === i ? 0.5 : 1 }}
            >
              <s-box
                padding="small-200"
                borderWidth="base"
                borderRadius="base"
                borderColor={f.id === selectedId ? "strong" : "base"}
                background={f.id === selectedId ? "subdued" : "base"}
              >
                <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-icon type="drag-handle" />
                    <s-clickable onClick={() => setSelectedId(f.id)} accessibilityLabel={`Edit ${f.label || FIELD_TYPE_LABELS[f.type]}`}>
                      <s-text type="strong">{f.label || f.helpText?.slice(0, 40) || FIELD_TYPE_LABELS[f.type]}</s-text>
                    </s-clickable>
                    <s-badge>{FIELD_TYPE_LABELS[f.type]}</s-badge>
                    {f.required ? <s-badge tone="info">Required</s-badge> : null}
                    {f.visibility === "admin" ? <s-badge tone="warning">Admin only</s-badge> : null}
                  </s-stack>
                  <s-button-group>
                    <s-button slot="secondary-actions" icon="arrow-up" accessibilityLabel="Move up" disabled={i === 0} onClick={() => move(i, i - 1)} />
                    <s-button slot="secondary-actions" icon="arrow-down" accessibilityLabel="Move down" disabled={i === schema.fields.length - 1} onClick={() => move(i, i + 1)} />
                    <s-button slot="secondary-actions" icon="duplicate" accessibilityLabel="Duplicate" disabled={SINGLETON_FIELD_TYPES.includes(f.type)} onClick={() => duplicate(i)} />
                    <s-button slot="secondary-actions" icon="delete" tone="critical" accessibilityLabel="Delete" onClick={() => remove(i)} />
                  </s-button-group>
                </s-stack>
              </s-box>
            </div>
          ))}
          <s-divider />
          <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="end">
            <s-select label="Add a field from the library" value={newType} onChange={(e) => setNewType(val(e) as FieldType)}>
              {FIELD_TYPES.map((t) => (
                <s-option key={t} value={t} disabled={usedSingletons.has(t)}>
                  {FIELD_TYPE_LABELS[t]}
                  {usedSingletons.has(t) ? " (already added)" : ""}
                </s-option>
              ))}
            </s-select>
            <s-button icon="plus" onClick={addField} disabled={usedSingletons.has(newType)}>
              Add field
            </s-button>
          </s-grid>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading={selected ? "Edit field" : "No field selected"}>
        {selected ? (
          <FieldEditor field={selected} onChange={(patch) => updateField(selected.id, patch)} />
        ) : (
          <s-text color="subdued">Select a field to edit its settings.</s-text>
        )}
      </s-section>

      <s-section slot="aside" heading="Published versions">
        {loaderData.versions.length === 0 ? <s-text color="subdued">Not published yet.</s-text> : null}
        <s-unordered-list>
          {loaderData.versions.map((v) => (
            <s-list-item key={v.version}>
              Version {v.version} · {v.at}
              {loaderData.published?.version === v.version ? " (live)" : ""}
            </s-list-item>
          ))}
        </s-unordered-list>
        <s-paragraph color="subdued">
          Each request keeps the exact labels it was submitted with, even after you edit the form.
        </s-paragraph>
      </s-section>

      <s-modal id="preview-modal" heading="Customer preview" size="large">
        <s-stack direction="block" gap="base">
          <s-button-group>
            <s-button slot="secondary-actions" icon="desktop" onClick={() => setPreviewWidth("desktop")} variant={previewWidth === "desktop" ? "primary" : "secondary"}>
              Desktop
            </s-button>
            <s-button slot="secondary-actions" icon="mobile" onClick={() => setPreviewWidth("mobile")} variant={previewWidth === "mobile" ? "primary" : "secondary"}>
              Mobile
            </s-button>
          </s-button-group>
          <s-text color="subdued">Preview of the current draft. Submitting is disabled here. Your theme&apos;s fonts and colors also apply on the storefront.</s-text>
          <div style={{ display: "flex", justifyContent: "center", background: "#f1f1f1", padding: 16, borderRadius: 8 }}>
            <div
              style={{
                width: previewWidth === "mobile" ? 375 : "100%",
                maxWidth: "100%",
                background: "#fff",
                border: "1px solid #ddd",
                borderRadius: 8,
                overflow: "auto",
                maxHeight: "70vh",
                pointerEvents: "auto",
              }}
              onSubmit={(e) => e.preventDefault()}
              // Markup is generated by our renderer; every value is escaped (lib/storefront-render.ts).
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </s-stack>
      </s-modal>

      <s-modal id="reset-modal" heading="Reset to default template?">
        <s-paragraph>
          This replaces your draft with the standard EU withdrawal template. The live form is not changed until you
          publish. Previously submitted requests are not affected.
        </s-paragraph>
        <s-button slot="secondary-actions" commandFor="reset-modal" command="--hide">
          Cancel
        </s-button>
        <s-button slot="primary-action" variant="primary" tone="critical" commandFor="reset-modal" command="--hide" onClick={() => submit("reset")}>
          Reset draft
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
