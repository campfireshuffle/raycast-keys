import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  getFrontmostApplication,
  List,
  showToast,
  Toast,
  useNavigation,
  Keyboard,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { library } from "./storage";
import { Macro } from "./saved";
import { parse } from "./macro";
import { captureTarget, play, Target } from "./play";

const failure = (message: string) =>
  showToast({
    style: Toast.Style.Failure,
    title: "Macro operation stopped",
    message,
  });

function Editor({
  macro,
  text: initialText = "",
  refresh,
}: {
  macro?: Macro;
  text?: string;
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState(macro?.name ?? "");
  const [text, setText] = useState(initialText);
  const [mask, setMask] = useState(macro?.mask ?? false);
  const [interpret, setInterpret] = useState(macro?.interpret ?? false);
  const [busy, setBusy] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const lock = useRef(false);
  const { pop } = useNavigation();
  async function save() {
    if (lock.current) return;
    setNameTouched(true);
    lock.current = true;
    setBusy(true);
    try {
      await library.save({ name, mask, interpret }, text, macro);
      setText("");
      await refresh();
      pop();
    } catch (error) {
      await refresh();
      await failure(
        error instanceof Error ? error.message : "Could not save. Try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Form
      enableDrafts={false}
      isLoading={busy}
      navigationTitle={macro ? "Edit Macro" : "Create Macro"}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Macro" onSubmit={save} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="Name"
        value={name}
        onChange={setName}
        onBlur={() => setNameTouched(true)}
        placeholder="A name without secrets"
        storeValue={false}
        error={
          nameTouched && (!name.trim() || name.length > 80)
            ? "Use a name of 1–80 characters."
            : undefined
        }
      />
      {mask ? (
        <Form.PasswordField
          id="text"
          title="Text"
          value={text}
          onChange={setText}
          storeValue={false}
        />
      ) : (
        <Form.TextArea
          id="text"
          title="Text"
          value={text}
          onChange={setText}
          storeValue={false}
        />
      )}
      <Form.Checkbox
        id="mask"
        label="Mask text"
        value={mask}
        onChange={setMask}
        storeValue={false}
      />
      <Form.Checkbox
        id="interpret"
        label="Interpret macro tokens"
        value={interpret}
        onChange={setInterpret}
        storeValue={false}
      />
      <Form.Description text="Macros are saved in Raycast’s encrypted local database. Masking only hides this field; it does not protect memory. Use a name that contains no secrets." />
      <Form.Description
        text={
          interpret
            ? "Tokens: [enter] [tab] [escape] [backspace] [ctrl+a] [shift+tab] [wait:500]. Escape literal brackets and backslashes with backslash. Raw newlines are rejected."
            : "Literal text: brackets and backslashes stay unchanged. Printable US/ABC ASCII only, 1–2000 characters. No automatic Enter."
        }
      />
    </Form>
  );
}

export default function Entry() {
  const [items, setItems] = useState<Macro[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const { push } = useNavigation();
  async function refresh() {
    try {
      setItems(await library.list());
      setError(false);
    } catch {
      setItems([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    getFrontmostApplication()
      .then(captureTarget)
      .then(setTarget)
      .catch(() => setTarget(null));
    void refresh();
  }, []);
  async function operate(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      await failure(
        error instanceof Error ? error.message : "Operation failed. Try again.",
      );
    } finally {
      await refresh();
      lock.current = false;
      setBusy(false);
    }
  }
  const create = (
    <Action
      title="Create Macro"
      onAction={() => {
        if (!lock.current) push(<Editor refresh={refresh} />);
      }}
      shortcut={Keyboard.Shortcut.Common.New}
    />
  );
  return (
    <List
      isLoading={loading || busy}
      searchBarPlaceholder="Search macro names…"
      actions={
        <ActionPanel>
          {error ? <Action title="Retry Loading" onAction={refresh} /> : create}
        </ActionPanel>
      }
    >
      <List.EmptyView
        title={
          error
            ? "Could Not Load Macros"
            : loading
              ? "Loading Macros"
              : "No Saved Macros"
        }
        description={
          error
            ? "Local metadata is unreadable. Restore it before making changes."
            : "Create a named macro, then press Enter to type it into the app you opened this command from."
        }
        actions={
          <ActionPanel>
            {error ? (
              <Action title="Retry Loading" onAction={refresh} />
            ) : (
              create
            )}
          </ActionPanel>
        }
      />
      {items.map((m) => (
        <List.Item
          key={m.id}
          title={m.name}
          actions={
            <ActionPanel>
              <Action
                title="Type Macro"
                onAction={() =>
                  operate(async () => {
                    if (!target)
                      throw new Error(
                        "Target unavailable. Reopen this command from the target app.",
                      );
                    const text = await library.text(m);
                    const steps = parse(text, !m.interpret);
                    await play(target, steps);
                    await showToast({
                      style: Toast.Style.Success,
                      title: "Keystrokes sent",
                      message: "Check the destination before continuing.",
                    });
                  })
                }
              />
              <Action
                title="Edit Macro"
                onAction={() =>
                  operate(async () => {
                    const text = await library.text(m);
                    push(<Editor macro={m} text={text} refresh={refresh} />);
                  })
                }
                shortcut={Keyboard.Shortcut.Common.Edit}
              />
              {create}
              <Action
                title="Delete Macro"
                style={Action.Style.Destructive}
                onAction={() =>
                  operate(async () => {
                    if (
                      await confirmAlert({
                        title: "Delete this macro?",
                        message:
                          "This removes its saved text from the local library.",
                        primaryAction: {
                          title: "Delete",
                          style: Alert.ActionStyle.Destructive,
                        },
                      })
                    )
                      await library.delete(m);
                  })
                }
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
