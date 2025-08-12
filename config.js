const urlParams = new URLSearchParams(window.location.search);
const CONFIG_VAR = urlParams.get('configVar');
const CONFIG_URL = urlParams.get('configUrl');
const CONNECT = (urlParams.get('connect') ?? "true").match(/true/i);;
const EDIT = (urlParams.get('edit') ?? "false").match(/true/i);
const DEBUGMODE = (urlParams.get('debug') ?? "false").match(/true/i);

function DEBUG(...args)
{
    if (DEBUGMODE) {
        console.debug(`WEBCONFIG: ${(new Date()).toISOString()}`, ...args);
    }
}


let helpTimer;

window.addEventListener("load", () => {
    // Do not connect to streamer.bot
    if (!CONNECT) {
        initConfig();
        return;
    }
    
    DEBUG("Loaded");
    const store = window.localStorage;
    document.getElementById("landingHost").value = store.getItem("sbHost") ?? "127.0.0.1";
    document.getElementById("landingPort").value = store.getItem("sbPort") ?? "8080";
    document.getElementById("landingEndpoint").value  = store.getItem("sbEndpoint") ?? "/";
    document.getElementById("landingPassword").value  = store.getItem("sbPassword") ?? "";
    document.getElementById("landingSecure").checked  = (store.getItem("sbSecure") === "true");
    makePasswordToggler(document.getElementById("landingPasswordContainer"));

    document.getElementById("landingPageConnect").addEventListener("click", attemptConnection);

    helpTimer = window.setTimeout(() => {
        document.getElementById("landingHelp").style.display = "block";
    }, 2000);

    attemptConnection();

});

// Tries to open a streamerbot client, aborting any currently in progress.

var client = null;
function attemptConnection()
{
    DEBUG(`${client}?.disconnect()`);
    client?.disconnect();
    const store = window.localStorage;
    const host = document.getElementById("landingHost").value;
    const port = document.getElementById("landingPort").value;
    const endpoint = document.getElementById("landingEndpoint").value;
    const password = document.getElementById("landingPassword").value;
    const secure = document.getElementById("landingSecure").checked;
    store.setItem("sbHost", host);
    store.setItem("sbPort", port);
    store.setItem("sbEndpoint", endpoint);
    store.setItem("sbPassword", password);
    store.setItem("sbSecure", secure);
    const scheme = secure ? "wss" : "ws";
    DEBUG(`Making new client to ${scheme}://${host}:${port}${endpoint}`);
    client = new StreamerbotClient({
        host: host,
        port: port,
        endpoint: endpoint,
        password: password,
        scheme: scheme,
        logLevel: DEBUGMODE ? "verbose" : "info",
        onConnect: wsConnected,

        onError: (err) => {
            console.error('Streamer.bot Client Error', err);
        },

        onDisconnect: () => {
            console.warn('Streamer.bot Client Disconected!');
        },

        onData: (data) => {
            DEBUG('Streamer.bot Data Received', data);
        },
        
    });
    DEBUG(`New client: ${client}`);
}

async function wsConnected(event)
{
    DEBUG(`Websocket connected: ${JSON.stringify(event, null, 2)}`);
    setTimeout(initConfig, 2000);
}

// Once we've connected to streamer.bot, hide the landing page,
// and initialize the configuration page.

async function initConfig()
{
    try {
        if (helpTimer !== null) {
            clearTimeout(helpTimer);
            helpTimer = null;
        }
        document.getElementById("landingPage").style.display = "none";
        document.getElementById("configContent").style.display = "block";

        let configStr;
        
        if (CONFIG_VAR) { // Configuration comes from a Streamer.bot temp variable
            DEBUG(`Fetching config spec ${CONFIG_VAR}`);
            let response = await client.getGlobal(CONFIG_VAR, false);
            if (response.status === "ok") {
                configStr = response.variable.value;
            }
        } else if (CONFIG_URL) { // Configuration comes from a HTTP fetch
            DEBUG(`Fetching sample config from ${CONFIG_URL}`);
            let response = await fetch(`${CONFIG_URL}?v=${Date.now()}`);
            if (response.status === 200) {
                configStr = await response.text();
            }
        }
        if (configStr) {
            DEBUG(`Got config`);
            if (EDIT) {
                initEditor(configStr);
            }
            buildConfig(configStr);
        }
    } catch (e)
    {
        DEBUG(e);
    }
}

function initEditor(config)
{
    DEBUG("Initializing editor");
    document.getElementById("configEditor").style.display = "block";
    // document.getElementById("jsonEditor").value = configStr;
    // create the editor
    const container = document.getElementById("jsonEditor");
    const editor = new JSONEditor(container, {
        modes: ["tree", "text"],
        limitDragging: true,
        name: "ConfigOptions",
        mainMenuBar: true,
        navigationBar: true,
        statusBar: false,
        enableSort: false,
        enableTransform: false,
        onChange: () => {
            buildConfig(editor.getText());
        },
    });
    DEBUG(`editor is ${editor}`);
    
    // set json
    const initialJson = JSON.parse(config);
    editor.set(initialJson)
    editor.expandAll();

    const getButton = document.getElementById("getJson");
    getButton.addEventListener("click", () =>
        {
            const json = JSON.stringify(editor.get());
            navigator.clipboard.writeText(json)
                .then(() => {
                    getButton.innerText = "Copied!";
                    setTimeout(() => {
                        getButton.innerText = "Copy JSON to clipboard";
                    },
                               5000);
                })
                .catch(err => {
                    console.error("Failed to copy text: ", err);
                });
        });
}

var nextId = 0;

// Builds out the HTML UI for the list of config variables in CONFIG

let conditionals = [];
let widgets = {};

function buildConfig(configStr)
{
    // DEBUG(`Config value is ${configStr}`);
    let config = JSON.parse(configStr);
    const configArea = document.getElementById("configArea");
    configArea.replaceChildren();

    // Set the page & header title
    const title = config.title ?? "Streamer.bot Extension Config";
    document.title = title;
    document.getElementById("title").textContent = config.title;

    // Add a link to the extension, if supplied
    const extLink = document.getElementById("extensionLink");
    const extText = document.getElementById("extensionText");
    if (config.extensionURL) {
        extLink.href = config.extensionURL;
        extLink.innerText = config.extensionText;
        extText.innerText = "";
    } else if (config.extensionText) {
        extLink.innerText = "";
        extText.innerText = config.extensionText;
    }

    // Build each configuration option listed.
    for (const option of config.options)
    {
        buildConfigOption(option, configArea);
    }

    // Add rules for the conditionsl options.
    addConditionals(widgets, conditionals);
}

function buildConfigOption(option, parent)
{
    DEBUG(`creating config option ${option.name}, type ${option.type}`);

    // Create the HTML UI widget representing this option, and insert it
    
    let ui = makeOptionUI(option);
    let uielt = ui.getElement()

    // Process any conditional expressions Add conditional enablement if specified.
    try {
        if (option.showIf) {
            conditionals.push([uielt, option.showIf, compileExpression(option.showIf)]);
        }
    } catch (e) {
        ui = new ErrorUI(option.name, `showIf error: ${e}`, option);
        uielt = ui.getElement();
    }

    widgets[ui.name] = ui;


    // Insert the option's description into any .description element that was supplied
    if (option.description) {
        // DEBUG(`Trying to insert description ${option.description}`);
        const desc = uielt.querySelector(".description");
        if (desc) {
            // DEBUG(`got ${desc}`);
            desc.textContent = option.description;
        }
    }

    // Add the UI to the document
    parent.appendChild(uielt);
    
    // Initialize the value of the option, either with the current global variable,
    // or the default if the global can't be fetched.
    //
    (async () => {
        DEBUG(`Requesting current value of ${option.name}`);
        return client.getGlobal(option.name, true).then(({variable: {value}}) => {
            DEBUG(`received current value of "${option.name}" = ${value}`);
            ui.setValue(value);
            ui.triggerValueCallbacks();
        });
    })().catch((error) => {
        // If we couldn't get a current value, presumeably because
        // it doesn't exist yet, then set the UI to contain the default value,
        // and then trigger the change callback so that it gets stored.
        if (option.default !== undefined) {
            ui.setValue(option.default);
            ui.change(option.default);
        } else {
            ui.triggerValueCallbacks();
        }
    });
    
    // Arrange for the global to be updated when the UI changes the value.
    //
    if (client) {
        ui.onChange(() => {
            client.doAction({name: "WC - Set Config Global"},
                            {
                                "globalName": option.name,
                                "globalValue": ui.getValue()
                            });
        });
    };
}


// Creates the OptionUI object that implements the json OPTION.
function makeOptionUI(option)
{
    try {
        switch (option.type)
        {
            case "string":
            case "text":
                return new TextOption(option.name, option);
            case "password":
                return new PasswordOption(option.name, option);
            case "slider":
                return new NumberSliderOption(option.name, option);
            case "number":
                return new NumberOption(option.name, option);
            case "bool":
            case "boolean":
                return new BoolOption(option.name, option);
            case "file":
                return new FileOption(option.name, option);
            case "select":
                return new SelectOption(option.name, option);

            case "group" :
                return new GroupOption(option);
            default:
                return new ErrorUI(option.name, `unknown option type "${option.type}"`, option);
        }
    } catch (e)
    {
        return new ErrorUI(option.name, `${e}`, option);
    }
}

// Makes an element from HTML text
function makeElt(html)
{
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content.firstElementChild;
}

// Returns HTML-encoded text.
function escapeText(text)
{
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")  // For double-quoted attributes
    .replace(/'/g, "&#39;")   // For single-quoted attributes
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")  // For double-quoted attributes
    .replace(/'/g, "&#39;")   // For single-quoted attributes
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Adds conditional dependencies between options
function addConditionals(widgets, conditionals)
{
    for (const [elt, expr, compiled] of conditionals)
    {
        const identifierPattern = /\b[a-zA-Z_$][a-zA-Z0-9_.$]*\b/g;
        const matches = expr.match(identifierPattern) || [];
        const variables = matches.filter(id => id in widgets);

        // This is the function that evaluates the dependency options
        // and determies if this element should be hidden or not.
        const evaluator = (newVal) => {
            // Collect the values of all the named widgets into the evaluation context.
            const context = {};
            variables.forEach((variable) => {
                context[variable] = widgets[variable].getValue();
            });
            // Evaluate expr, and enable/disable elt
            DEBUG(`Evaluating '${expr}'`);
            const evalResult = compiled(context);
            DEBUG(`Evaluated '${expr}' => ${evalResult} (${evalResult ? "true" : "false"})`);
            
            if (evalResult) {
                elt.classList.remove("hidden");
            } else {
                elt.classList.add("hidden");
            }
        };

        // Register change notifications with the dependencies.
        variables.map(id => widgets[id])
            .forEach(w => {
                w.onValue(evaluator);
            });
    }
}



//
// Base class for the UI widgets that edit a single configuration option.
//
class OptionUI {
    static #nextId = 0;

    name; // the name of the streamer.bot global variable of the config option.
    options; // The JSON object

    // NAME: the name of the global variable that holds the option's value.
    // OPTIONS: The json object of the options spec.
    //
    constructor(name, options) {
        // DEBUG(`Making option ${name}`);
        this.name = name;
        this.id = `input-${nextId++}`;
        this.options = options;
    }

    changeCallback = [];
    
    // Registers a CALLBACK for when the option's value changes.
    //
    onChange(callback) {
        this.changeCallback.push(callback);
    }
    
    // Internal method to invoke the change callback
    //
    change(newVal) {
        this.changeCallback.forEach((c) => c(newVal));
        this.triggerValueCallbacks();
    }

    valueCallback = [];

    // Registers a CALLBACK for whenever a new value gets set, either internally or by user.
    onValue(callback) {
        this.valueCallback.push(callback);
    }
    triggerValueCallbacks()
    {
        this.valueCallback.forEach((c) => c());
    }
    
    // Returns a DOM element to insert into the UI to allow the config option
    // to be edited.
    //
    getElement() {
        return makeElt(`<div class="configOption">Bogus option "${escapeText(this.name)}"</div>`);
    }

    // Sets the UI to the given VALUE. VALUE should be the appropriate logical
    // type for the option.
    //
    setValue(value) {}

    // Gets the current value from the UI, as the appropriate logical type.
    //
    getValue() { return undefined; }
}

// When you want to show an option that isn't configured correctly.
class ErrorUI extends OptionUI {
    constructor(name, message, options) {
        super(name, options);
        this.message = message;
    }
    getElement() {
        return makeElt(`<div class="configOption"><label>${escapeText(this.options.label ?? this.name ?? "<anonymous>")}: <div class="errorDescription">${escapeText(this.message)}</div></label>`);
    }
    
}

// An option that represents a group of nested options.
class GroupOption extends OptionUI
{
    static #optionId = 0;
    
    constructor(option) {
        // groups don't really need names, since they don't set a variable
        // or get referenced on any other way. But we'll give them one anyway.
        super(option.name || `group-${GroupOption.#optionId++}`, option);

        let label = option.label;
        let desc = option.description;

        this.#elt = makeElt(
            `<div class="configOption optionGroup">`
                +
                ((label || desc) ? `<label>${escapeText(this.options.label || "")}
                   <div class="description"></div></label>
                 </label>` : "")
                +
                `<div class="nestedOptions"></div>
             </div>`
        );

        const parent = this.#elt.querySelector(".nestedOptions");
        for (const o of option.options)
        {
            buildConfigOption(o, parent);
        }
    }

    #elt
    
    getElement() {
        return this.#elt;
    }
    

}

// Base class for UI based on the <input> tag.
//
class InputOption extends OptionUI
{
    // NAME, OPTIONS: See OptionUI
    // TYPE: the "type" attribute of the input.

    constructor(name, type, options) {
        super(name, options);
        this.type = type;
    }

    inputElt; // The actual HTMLInputElement for editing the value,
              // set as a side-effect of getElement()
    
    getElement() {
        const elt = makeElt(
        `<div class="configOption">
          <label for="${this.id}">${escapeText(this.options.label ?? this.name)}: <div class="description"></div></label>
          <div class="optionWidget"><input class="optionInput" id="${this.id}" type="${escapeAttr(this.type)}"/></div>
         </div>`
        );
        this.inputElt = elt.querySelector("input");

        this.inputElt.addEventListener("change", (event) => {
            this.change(this.getValue());
        });
        return elt;
    }
    
    getValue() {
        return this.inputElt.value;
    }

    setValue(newVal) {
        this.inputElt.value = newVal;
    }
}

// Specific Option UI for string options.

class TextOption extends InputOption {
    constructor(name, options) {
        super(name, "text", options);
    }
}

// Specific Option UI for secrets.

class PasswordOption extends InputOption {
    constructor(name, options) {
        super(name, "password", options);
    }

    getElement() {
        const elt = super.getElement();
        // Add a show/hide password button.
        makePasswordToggler(elt);
        return elt;
    }

}

function makePasswordToggler(container) {
    container.classList.add("password-container");
    const button = makeElt('<button class="toggle-eye" aria-label="Show password">&#x1f441;</button>');
    const input = container.querySelector("input");
    button.addEventListener("click", () => {
        const isHidden = input.type === "password";
        
        input.type = isHidden ? "text" : "password";
        button.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
        button.textContent = isHidden ? '\u{1F648}' : '\u{1F441}';
    });
    input.after(button);
}

// Specific Option UI for numbers.
// OPTIONS: may contain:
//   * min : the minimum value
//   * max : the maximum value
//   * inc : The value increments.

class NumberOption extends InputOption {
    constructor(name, options) {
        super(name, "number", options);
    }
    getElement() {
        const elt = super.getElement();
        if (this.options.min != null) this.inputElt.min = this.options.min;
        if (this.options.max != null) this.inputElt.max = this.options.max;
        if (this.options.inc != null) this.inputElt.step = this.options.inc;
        return elt;
    }
    getValue() {
        return Number.parseFloat(super.getValue());
    }
    
}

// Specific Option UI for numbers.
// OPTIONS: must contain:
//   * min : the minimum value
//   * max : the maximum value
// May contain:
//   * inc : The value increments.
//
// Note: This is a type of Number option, but there are enough internal differences
// to warrant an entirely custom implementation. Perhaps if warranted later,
// some refactoring to allow the slider to extend Number is warranted.
class NumberSliderOption extends OptionUI {
    constructor(name, options) {
        super(name, options);

        if (!("min" in this.options) ||
            !("max" in this.options))
        {
            throw new Error("Sliders require min and max properties");
        }
    }

    numberElt;
    sliderElt;
    
    getElement() {
        const elt = makeElt(
        `<div class="configOption">
          <label for="${this.id}">${escapeText(this.options.label ?? this.name)}: <div class="description"></div></label>
          <div class="optionWidget">
            <input class="optionSlider" style="text-align: right" id="${this.id}-slider" type="range" />
            <input class="optionInput" id="${this.id}-number" type="number"/>
          </div>
         </div>`
        );
        this.numberElt = elt.querySelector(`#${this.id}-number`);
        this.sliderElt = elt.querySelector(`#${this.id}-slider`);

        // Configure both input widgets
        this.numberElt.min = this.options.min;
        this.sliderElt.min = this.options.min;

        this.numberElt.max = this.options.max;
        this.sliderElt.max = this.options.max;

        if ("inc" in this.options) {
            this.numberElt.step = this.options.inc;
            this.sliderElt.step = this.options.inc;
        }

        // Sync both widgets when either changes, and fire the change handler.
        this.numberElt.addEventListener("change", (event) => {
            let val = this.numberElt.value;
            this.sliderElt.value = val;
            this.change(val);
        });
        this.sliderElt.addEventListener("change", (event) => {
            let val = this.sliderElt.value;
            this.numberElt.value = val;
            this.change(val);
        });
        // Also provide feedback as it's being slid
        this.sliderElt.addEventListener("input", (event) => {
            let val = this.sliderElt.value;
            this.numberElt.value = val;
        });
        return elt;
    }
    
    getValue() {
        return Number.parseFloat(this.numberElt.value);
    }

    setValue(newVal) {
        this.sliderElt.value = newVal;
        this.numberElt.value = newVal;
    }
}

// Specific Option UI for booleans.

class BoolOption extends InputOption {
    constructor(name, options) {
        super(name, "checkbox", options);
    }
    
    getValue() {
        return this.inputElt.checked;
    }

    setValue(newVal) {
        this.inputElt.checked = newVal;
    }
}
  
// Specific Option UI for choosing a file path.

class FileOption extends InputOption {
    constructor(name, options) {
        super(name, "file", options);
    }
    getElement() {
        const elt = super.getElement();
        if (this.options.accept != null) this.inputElt.accept = this.options.accept;
        return elt;
    }
    setValue(newVal) {
        // You can't set the file of a file picker, for security reasons.
    }
}
  
// Specific Option UI for choosing from a list.
// OPTIONS:
//   values : Array containing the list of items, which may be either:
//            * A single VALUE
//            * [VALUE, LABEL] : The value, and displayed label of the item

class SelectOption extends OptionUI
{
    constructor(name, options)
    {
        super(name, options);
    }

    getElement() {
        let options = "";
        // Create all the selectable values.
        for (let value of this.options.values) {
            // A value can be just a simple value, or an [value, label]
            let label = value;
            if (Array.isArray(value)) {
                label = value[1];
                value = value[0];
            }
            options += `<option value="${escapeAttr(value)}">${escapeText(label)}</option>`;
        }

        const elt = makeElt(
        `<div class="configOption">
         <label for="${this.id}">${escapeText(this.options.label ?? this.name)}: <div class="description"></div></label>
         <div class="optionWidget">
           <select class="optionInput" id="${this.id}">
           ${options}
           </select></div>`
        );
        this.selectElt = elt.querySelector("select");
        this.selectElt.addEventListener("change", (event) => {
            this.change(this.getValue());
        });
        return elt;
    }

    getValue() {
        return this.selectElt.value;
    }

    setValue(newVal) {
        this.selectElt.value = newVal;
    }
}
