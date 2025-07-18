const urlParams = new URLSearchParams(window.location.search);
const CONFIG_VAR = urlParams.get('configVar');
const CONFIG_URL = urlParams.get('configUrl');
const CONNECT = (urlParams.get('connect') ?? "true").match(/true/i);;
const EDIT = (urlParams.get('edit') ?? "false").match(/true/i);


let helpTimer;

window.addEventListener("load", () => {
    // Do not connect to streamer.bot
    if (!CONNECT) {
        initConfig();
        return;
    }
    
    console.log("Loaded");
    const store = window.localStorage;
    document.getElementById("landingHost").value = store.getItem("sbHost") ?? "127.0.0.1";
    document.getElementById("landingPort").value = store.getItem("sbPort") ?? "8080";
    document.getElementById("landingEndpoint").value  = store.getItem("sbEndpoint") ?? "/";
    document.getElementById("landingPassword").value  = store.getItem("sbPassword") ?? "";
    document.getElementById("landingSecure").checked  = (store.getItem("sbSecure") === "true");

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
    console.log("Making new streamer.bot client");
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
    client = new StreamerbotClient({
        host: host,
        port: port,
        endpoint: endpoint,
        password: password,
        scheme: secure ? "wss" : "ws",
        onConnect: initConfig,
    });
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
            console.log(`Fetching config spec ${CONFIG_VAR}`);
            let response = await client.getGlobal(CONFIG_VAR, false);
            if (response.status === "ok") {
                configStr = response.variable.value;
            }
        } else if (CONFIG_URL) { // Configuration comes from a HTTP fetch
            let response = await fetch(CONFIG_URL);
            if (response.status === 200) {
                configStr = await response.text();
            }
        }
        if (configStr) {
            if (EDIT) {
                initEditor(configStr);
            }
            createConfig(configStr);
        }
    } catch (e)
    {
        console.log(e);
    }
}

function initEditor(config)
{
    console.log("Initializing editor");
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
            createConfig(editor.getText());
        },
    });
    console.log(`editor is ${editor}`);
    
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

function createConfig(configStr)
{
    // console.log(`Config value is ${configStr}`);
    let config = JSON.parse(configStr);
    const ca = document.getElementById("configArea");
    ca.replaceChildren();

    const title = config.title ?? "Streamer.bot Extension Config";
    document.title = title;
    document.getElementById("title").textContent = config.title;
    
    for (const option of config.options)
    {
        console.log(`creating config option ${option.name}, type ${option.type}`);

        // Create the UI widget representing this option, and insert it
        
        const ui = makeOptionUI(option);
        const uielt = ui.getElement()
        if (option.description) {
            console.log(`Trying to insert description ${option.description}`);
            // hack: insert the description into an element with the "description" class.
            const desc = uielt.querySelector(".description");
            if (desc) {
                console.log(`got ${desc}`);
                desc.textContent = option.description;
            }
        }
        ca.appendChild(uielt);
        
        // populate the current stored value
        //
        (async () => {
            return client.getGlobal(option.name, true).then(({variable: {value}}) => {
                console.log(`got initial value of "${option.name}" = ${value}`);
                ui.setValue(value);
            });
        })().catch((error) => {
            // If we couldn't get a current value, presumeably because
            // it doesn't exist yet, then set the UI to contain the default value,
            // and then trigger the change callback so that it gets stored.
            if (option.default !== undefined) {
                ui.setValue(option.default);
                ui.change(option.default);
            }
        });
        
        // Update the value permanently when changed.
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
}

// Creates the OptionUI object that implements the json OPTION.
function makeOptionUI(option)
{
    switch (option.type)
    {
        case "string":
        case "text":
          return new TextOption(option.name, option);
        case "password":
          return new PasswordOption(option.name, option);
        case "number":
          return new NumberOption(option.name, option);
        case "bool":
        case "boolean":
          return new BoolOption(option.name, option);
        case "file":
          return new FileOption(option.name, option);
        case "select":
          return new SelectOption(option.name, option);
        
        default:
          return new OptionUI(option.name);
    }
}

// Makes an element from HTML text
function makeElt(html)
{
    const template = document.createElement('template');
    template.innerHTML = html;
    return element = template.content.firstElementChild;
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
        console.log(`Making option ${name}`);
        this.name = name;
        this.id = `input-${nextId++}`;
        this.options = options;
    }

    // Registers a CALLBACK for when the option's value changes.
    //
    onChange(callback) {
        this.changeCallback = callback;
    }
    
    // Internal method to invoke the change callback
    //
    change(newVal) {
        if (this.changeCallback) {
            this.changeCallback(newVal);
        }
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
          <input class="optionInput" id="${this.id}" type="${escapeAttr(this.type)}"/>
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
         <select class="optionInput" id="${this.id}">
           ${options}
         </select>`
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
