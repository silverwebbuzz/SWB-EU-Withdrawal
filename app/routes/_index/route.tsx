import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>EU withdrawal button &amp; request management</h1>
        <p className={styles.text}>
          A visible withdrawal function for your Shopify store: a guest-friendly form with review step, email
          confirmations and an inbox to manage every request.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>No-code form builder</strong>. Build your withdrawal form from predefined fields, preview it and
            publish versions.
          </li>
          <li>
            <strong>Two-step confirmation</strong>. Customers review before submitting and receive a reference number and
            confirmation email.
          </li>
          <li>
            <strong>Request inbox</strong>. Search, filter, add notes, track status changes and export to CSV.
          </li>
        </ul>
      </div>
    </div>
  );
}
