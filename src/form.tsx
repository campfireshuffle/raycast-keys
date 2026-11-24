import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  getFrontmostApplication,
  Icon,
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
    title: "Could Not Complete Action",
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
        placeholder="Work login"
        info="Names appear in the list. Keep secrets in Text."
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
        info="Hides text in this editor only."
        value={mask}
        onChange={setMask}
        storeValue={false}
      />
      <Form.Checkbox
        id="interpret"
        label="Use key commands"
        info="Commands: [enter], [tab], [escape], [backspace], [ctrl+a], [shift+tab], [wait:500]. Use \\ before literal brackets or backslashes. No raw newlines or tabs."
        value={interpret}
        onChange={setInterpret}
        storeValue={false}
      />
      <Form.Description
        text={
          interpret
            ? "hello[tab]world types hello, presses Tab, then types world. Only enable key commands when you want special keys, not literal text."
            : "Types text exactly as entered, including brackets and backslashes. Use 1–2000 printable US/ABC ASCII characters. Enter is never added automatically."
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
      icon={Icon.Plus}
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
          {error ? (
            <Action
              title="Retry Loading"
              icon={Icon.ArrowClockwise}
              onAction={refresh}
            />
          ) : (
            create
          )}
        </ActionPanel>
      }
    >
      <List.EmptyView
        icon={
          error
            ? Icon.ExclamationMark
            : items.length
              ? Icon.MagnifyingGlass
              : Icon.Keyboard
        }
        title={
          error
            ? "Could Not Load Macros"
            : loading
              ? "Loading Macros…"
              : items.length
                ? "No Matching Macros"
                : "Create Your First Macro"
        }
        description={
          error
            ? "Try loading again. If this continues, close and reopen the command."
            : loading
              ? "Your saved macros will appear here."
              : items.length
                ? "Try another name or clear the search."
                : "Save text with a name, then press Enter to type it into the app you opened this command from."
        }
        actions={
          <ActionPanel>
            {error ? (
              <Action
                title="Retry Loading"
                icon={Icon.ArrowClockwise}
                onAction={refresh}
              />
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
          icon={m.mask ? Icon.Lock : Icon.Keyboard}
          actions={
            <ActionPanel>
              <ActionPanel.Section>
                <Action
                  title="Type Macro"
                  icon={Icon.Keyboard}
                  onAction={() =>
                    operate(async () => {
                      if (!target)
                        throw new Error(
                          "Open the app and field you want to type into, then reopen this command.",
                        );
                      const text = await library.text(m);
                      const steps = parse(text, !m.interpret);
                      await play(target, steps);
                      await showToast({
                        style: Toast.Style.Success,
                        title: "Macro Typed",
                      });
                    })
                  }
                />
              </ActionPanel.Section>
              <ActionPanel.Section>
                <Action
                  title="Edit Macro"
                  icon={Icon.Pencil}
                  onAction={() =>
                    operate(async () => {
                      const text = await library.text(m);
                      push(<Editor macro={m} text={text} refresh={refresh} />);
                    })
                  }
                  shortcut={Keyboard.Shortcut.Common.Edit}
                />
                {create}
              </ActionPanel.Section>
              <ActionPanel.Section>
                <Action
                  title="Delete Macro"
                  icon={Icon.Trash}
                  shortcut={Keyboard.Shortcut.Common.Remove}
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
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
