/**
 * RecoveryBanner — the PERSISTENT failure / writer-held banner (blocky §2.6).
 * Unlike the transient notices dock it does not retire on a timer: it stays
 * until a reconnect / new-session / quit action changes the recovery phase.
 *
 * Actions are wired to the RecoveryUiController (not to new key bindings
 * here): R is owned by the page keymap layer, and the two button handlers
 * reuse the page's existing new-session / quit paths. Labels come from the
 * controller's injected i18n texts, so both locales stay in sync.
 */
import { For, Show, createSignal, onCleanup, type JSX } from "solid-js"
import { useThemeOptional } from "../../context/theme"
import type { RecoveryUiController } from "./recovery-ui"

export function RecoveryBanner(props: { controller: RecoveryUiController }): JSX.Element {
	const theme = useThemeOptional()
	const [version, setVersion] = createSignal(0)
	onCleanup(props.controller.subscribe(() => setVersion((v) => v + 1)))
	const controller = props.controller
	const banner = () => {
		version() // subscribe to controller phase/banner changes
		return controller.banner
	}
	const actions = () => {
		if (banner() === undefined) return []
		return banner()?.kind === "failed"
			? [
					{ label: controller.texts.reconnect(), run: () => void controller.recover() },
					{ label: controller.texts.newSession(), run: () => controller.newSession() },
					{ label: controller.texts.quit(), run: () => controller.quit() },
				]
			: [
					{ label: controller.texts.retry(), run: () => void controller.recover() },
					{ label: controller.texts.newSession(), run: () => controller.newSession() },
				]
	}
	const warning = () => theme?.text.feedback.warning.base ?? "#e0af68"
	return (
		<Show when={banner() !== undefined} fallback={null}>
			<box
				flexShrink={0}
				width="100%"
				flexDirection="column"
				border
				borderStyle="single"
				borderColor={warning()}
				paddingLeft={1}
				paddingRight={1}
			>
				<text fg={warning()} wrapMode="none">
					{banner()?.reason ?? ""}
				</text>
				<box flexDirection="row" gap={2} height={1}>
					<For each={actions()}>
						{(action) => (
							<text fg={theme?.text.muted ?? "#9aa5ce"} wrapMode="none" onMouseUp={() => action.run()}>
								{action.label}
							</text>
						)}
					</For>
				</box>
			</box>
		</Show>
	)
}
