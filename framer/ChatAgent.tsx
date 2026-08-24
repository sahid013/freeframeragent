import {addPropertyControls, ControlType, RenderTarget} from "framer"
import {useMemo} from "react"

/**
 * ChatAgent — a Framer code component.
 *
 * Paste this into your Framer project (Assets → Code → New Code File) and set
 * `Base URL` to your deployed Next.js app. It embeds the Astryx-styled chat
 * surface hosted at `<Base URL>/embed`.
 *
 * Why an iframe rather than rendering the chat directly here: the UI is built
 * on Astryx (@astryxdesign/core), which needs React 19 and three imported
 * stylesheets. Framer code components can't import CSS files, so the chat is
 * rendered by the Next.js app and embedded. This also keeps your OpenRouter
 * key on the server — the browser never sees it.
 *
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 * @framerIntrinsicWidth 420
 * @framerIntrinsicHeight 620
 * @framerDisableUnlink
 */
export default function ChatAgent(props) {
    const {
        baseUrl,
        agent,
        model,
        mode,
        density,
        transparent,
        showSuggestions,
        name,
        greeting,
        placeholder,
        avatar,
        radius,
        border,
        style,
    } = props

    const src = useMemo(() => {
        const trimmed = (baseUrl || "").trim().replace(/\/+$/, "")
        if (!trimmed) return ""

        const params = new URLSearchParams()
        params.set("agent", agent)
        if (model) params.set("model", model)
        params.set("mode", mode)
        params.set("density", density)
        if (transparent) params.set("bg", "transparent")
        if (!showSuggestions) params.set("suggestions", "off")
        if (name) params.set("name", name)
        if (greeting) params.set("greeting", greeting)
        if (placeholder) params.set("placeholder", placeholder)
        if (avatar?.src) params.set("avatar", avatar.src)

        return `${trimmed}/embed?${params.toString()}`
    }, [
        baseUrl,
        agent,
        model,
        mode,
        density,
        transparent,
        showSuggestions,
        name,
        greeting,
        placeholder,
        avatar?.src,
    ])

    const frame = {
        width: "100%",
        height: "100%",
        borderRadius: radius,
        overflow: "hidden",
        border: border ? "1px solid rgba(0,0,0,0.1)" : "none",
        background: transparent ? "transparent" : "rgba(0,0,0,0.02)",
        ...style,
    }

    if (!src) {
        return (
            <div style={{...frame, ...placeholderStyle}}>
                Set <b>Base URL</b> to your deployed app, e.g.
                <br />
                https://your-app.vercel.app
            </div>
        )
    }

    // Don't load the live agent on the canvas — it would fire real API calls on
    // every edit. Preview and the published site get the real thing.
    if (RenderTarget.current() === RenderTarget.canvas) {
        return (
            <div style={{...frame, ...placeholderStyle}}>
                {name || agent} agent
                <br />
                <span style={{opacity: 0.6}}>Open Preview to chat</span>
            </div>
        )
    }

    return (
        <iframe
            src={src}
            title={name || "Chat agent"}
            style={{...frame, display: "block"}}
            allow="clipboard-write; microphone"
            loading="lazy"
        />
    )
}

const placeholderStyle = {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    gap: 4,
    padding: 16,
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 13,
    lineHeight: 1.5,
    color: "rgba(0,0,0,0.55)",
}

ChatAgent.defaultProps = {
    baseUrl: "",
    agent: "assistant",
    model: "",
    mode: "system",
    density: "balanced",
    transparent: false,
    showSuggestions: true,
    name: "",
    greeting: "",
    placeholder: "",
    radius: 16,
    border: true,
}

addPropertyControls(ChatAgent, {
    baseUrl: {
        type: ControlType.String,
        title: "Base URL",
        placeholder: "https://your-app.vercel.app",
        description: "Your deployed Next.js app. No trailing slash.",
    },
    agent: {
        type: ControlType.Enum,
        title: "Agent",
        options: ["assistant", "support", "sales"],
        optionTitles: ["Assistant", "Support", "Sales"],
        description: "Personas live on the server in src/lib/agents.ts.",
    },
    model: {
        type: ControlType.Enum,
        title: "Model",
        options: [
            "",
            "stealth/ox-alpha",
            "openai/gpt-4o",
            "openai/gpt-4o-mini",
            "anthropic/claude-sonnet-4.5",
            "anthropic/claude-haiku-4.5",
            "google/gemini-2.5-flash",
            "meta-llama/llama-3.3-70b-instruct",
        ],
        optionTitles: [
            "Default",
            "Ox Alpha (free)",
            "GPT-4o",
            "GPT-4o mini",
            "Claude Sonnet 4.5",
            "Claude Haiku 4.5",
            "Gemini 2.5 Flash",
            "Llama 3.3 70B",
        ],
    },
    mode: {
        type: ControlType.Enum,
        title: "Theme",
        options: ["system", "light", "dark"],
        optionTitles: ["System", "Light", "Dark"],
        displaySegmentedControl: true,
    },
    density: {
        type: ControlType.Enum,
        title: "Density",
        options: ["compact", "balanced", "spacious"],
        optionTitles: ["Compact", "Balanced", "Spacious"],
        displaySegmentedControl: true,
    },
    name: {
        type: ControlType.String,
        title: "Name",
        placeholder: "Assistant",
    },
    greeting: {
        type: ControlType.String,
        title: "Greeting",
        placeholder: "Ask me anything",
    },
    placeholder: {
        type: ControlType.String,
        title: "Input hint",
        placeholder: "Ask a question…",
    },
    avatar: {
        type: ControlType.ResponsiveImage,
        title: "Avatar",
    },
    showSuggestions: {
        type: ControlType.Boolean,
        title: "Suggestions",
        enabledTitle: "Show",
        disabledTitle: "Hide",
    },
    transparent: {
        type: ControlType.Boolean,
        title: "Background",
        enabledTitle: "Clear",
        disabledTitle: "Solid",
    },
    radius: {
        type: ControlType.Number,
        title: "Radius",
        min: 0,
        max: 48,
        step: 1,
        displayStepper: true,
    },
    border: {
        type: ControlType.Boolean,
        title: "Border",
    },
})
