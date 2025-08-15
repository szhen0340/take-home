chrome.storage.local.get(["EXTENSION_CONSTANTS"], (result) => {
  if (result.EXTENSION_CONSTANTS) {
    MESSAGE_TYPES = result.EXTENSION_CONSTANTS.MESSAGE_TYPES;
    CONFIG = result.EXTENSION_CONSTANTS.CONFIG;
    ACTION_ICONS = result.EXTENSION_CONSTANTS.ACTION_ICONS;
    new ActionRecorder();
  }
});

class ActionRecorder {
  // ===== INITIALIZATION =====
  constructor() {
    if (window.isActionRecorderInjected) return;
    window.isActionRecorderInjected = true;

    // Track timing for delay calculation
    this.lastActionTime = Date.now();
    this.attachEventListeners();

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "REQUEST_NAVIGATION") {
        this.recordNavigation();
      }
    });
  }

  // ===== SELECTOR & ELEMENT ANALYSIS =====
  generateSelector(element) {
    if (!element) return null;
    if (element.id) return `#${element.id}`;

    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.nodeName.toLowerCase();

      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      }

      const siblings = Array.from(current.parentNode?.children || []).filter(
        (sibling) => sibling.nodeName.toLowerCase() === selector
      );

      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }

      path.unshift(selector);
      current = current.parentNode;
    }

    return path.join(" > ");
  }

  generateFallbackSelectors(element) {
    const fallbackSelectors = [];

    // Strategy 1: Use data-testid attributes
    const dataTestId =
      element.getAttribute("data-testid") ||
      element.getAttribute("data-test-id");
    if (dataTestId) {
      fallbackSelectors.push(`[data-testid="${dataTestId}"]`);
    }

    // Strategy 2: Use class-based selectors
    if (element.className && typeof element.className === "string") {
      const classes = element.className.trim().split(/\s+/);
      if (classes.length > 0) {
        fallbackSelectors.push(`.${classes[0]}`);
      }
    }

    // Strategy 3: Use nth-child selector
    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (sib) => sib.tagName.toLowerCase() === element.tagName.toLowerCase()
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(element) + 1;
        fallbackSelectors.push(
          `${element.tagName.toLowerCase()}:nth-child(${index})`
        );
      }
    }

    const tagName = element.tagName.toLowerCase();
    const textContent = element.textContent?.trim();
    if ((tagName === "button" || tagName === "a") && textContent) {
      fallbackSelectors.push(
        `${tagName}:contains("${textContent.substring(0, 20)}")`
      );
    }

    // Strategy 5: Use attribute-based selectors
    if (element.type) {
      fallbackSelectors.push(`${tagName}[type="${element.type}"]`);
    }

    return fallbackSelectors;
  }

  getWaitConditions(element) {
    const tagName = element.tagName.toLowerCase();
    const computedStyle = window.getComputedStyle(element);

    return {
      waitForSelector: true,
      waitForVisible:
        computedStyle.display !== "none" &&
        computedStyle.visibility !== "hidden",
      waitForEnabled: !element.disabled,
      waitForClickable: this.isClickable(element),
      timeout: 5000,
    };
  }

  isClickable(element) {
    const style = window.getComputedStyle(element);
    return (
      style.pointerEvents !== "none" &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  }

  getDetailedElementDescription(element) {
    if (!element) return "unknown element";

    let description = [];
    let context = [];

    const tagName = element.tagName.toLowerCase();
    description.push(`<${tagName}>`);

    const textContent = element.textContent?.trim().substring(0, 50) || "";
    if (textContent) {
      description.push(`text:"${textContent}"`);
    }

    if (element.id) {
      description.push(`id="${element.id}"`);
    }

    if (element.className && typeof element.className === "string") {
      const classes = element.className.trim().split(/\s+/).slice(0, 3);
      if (classes.length > 0 && classes[0]) {
        description.push(`class="${classes.join(" ")}"`);
      }
    }

    // Input-specific attributes
    if (tagName === "input") {
      const type = element.type || "text";
      description.push(`type="${type}"`);

      if (element.placeholder) {
        description.push(`placeholder="${element.placeholder}"`);
      }

      if (element.name) {
        description.push(`name="${element.name}"`);
      }

      // Determine input purpose
      const placeholder = (element.placeholder || "").toLowerCase();
      const name = (element.name || "").toLowerCase();
      const id = (element.id || "").toLowerCase();

      if (
        type === "search" ||
        placeholder.includes("search") ||
        name.includes("search") ||
        id.includes("search")
      ) {
        context.push("SEARCH_INPUT");
      } else if (
        placeholder.includes("email") ||
        name.includes("email") ||
        type === "email"
      ) {
        context.push("EMAIL_INPUT");
      } else if (
        placeholder.includes("password") ||
        name.includes("password") ||
        type === "password"
      ) {
        context.push("PASSWORD_INPUT");
      } else if (placeholder.includes("filter") || name.includes("filter")) {
        context.push("FILTER_INPUT");
      } else if (type === "submit") {
        context.push("SUBMIT_BUTTON");
      }
    }

    // Button analysis
    if (
      tagName === "button" ||
      (tagName === "input" && element.type === "button")
    ) {
      const buttonText = textContent.toLowerCase();
      const ariaLabel = (
        element.getAttribute("aria-label") || ""
      ).toLowerCase();

      if (buttonText.includes("search") || ariaLabel.includes("search")) {
        context.push("SEARCH_BUTTON");
      } else if (buttonText.includes("submit") || buttonText.includes("send")) {
        context.push("SUBMIT_BUTTON");
      } else if (
        buttonText.includes("login") ||
        buttonText.includes("sign in")
      ) {
        context.push("LOGIN_BUTTON");
      } else if (
        buttonText.includes("register") ||
        buttonText.includes("sign up")
      ) {
        context.push("REGISTER_BUTTON");
      } else if (buttonText.includes("add") || buttonText.includes("create")) {
        context.push("ADD_BUTTON");
      } else if (
        buttonText.includes("delete") ||
        buttonText.includes("remove")
      ) {
        context.push("DELETE_BUTTON");
      } else if (buttonText.includes("edit") || buttonText.includes("modify")) {
        context.push("EDIT_BUTTON");
      } else if (
        buttonText.includes("cancel") ||
        buttonText.includes("close")
      ) {
        context.push("CANCEL_BUTTON");
      }
    }

    // Link analysis
    if (tagName === "a") {
      const href = element.href;
      if (href) {
        description.push(`href="${href}"`);

        if (href.includes("#")) {
          context.push("ANCHOR_LINK");
        } else if (href.startsWith("mailto:")) {
          context.push("EMAIL_LINK");
        } else if (href.startsWith("tel:")) {
          context.push("PHONE_LINK");
        } else if (href !== window.location.href) {
          context.push("EXTERNAL_LINK");
        }
      }
    }

    // Form analysis
    if (tagName === "form") {
      const action = element.action;
      if (action) {
        description.push(`action="${action}"`);
      }
      context.push("FORM_CONTAINER");
    }

    // ARIA and accessibility attributes
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) {
      description.push(`aria-label="${ariaLabel}"`);
    }

    const role = element.getAttribute("role");
    if (role) {
      description.push(`role="${role}"`);

      if (role === "searchbox") {
        context.push("SEARCH_INPUT");
      } else if (role === "button") {
        context.push("BUTTON_ROLE");
      } else if (role === "navigation") {
        context.push("NAVIGATION");
      }
    }

    // Data attributes for additional context
    const dataTestId =
      element.getAttribute("data-testid") ||
      element.getAttribute("data-test-id");
    if (dataTestId) {
      description.push(`data-testid="${dataTestId}"`);
    }

    // Parent context for better understanding
    const parentTag = element.parentElement?.tagName.toLowerCase();
    if (parentTag === "nav") {
      context.push("IN_NAVIGATION");
    } else if (parentTag === "header") {
      context.push("IN_HEADER");
    } else if (parentTag === "footer") {
      context.push("IN_FOOTER");
    } else if (parentTag === "form") {
      context.push("IN_FORM");
    }

    // Check if element is inside a search container
    let currentElement = element.parentElement;
    let depth = 0;
    while (currentElement && depth < 5) {
      const parentClass = currentElement.className || "";
      const parentId = currentElement.id || "";

      if (
        parentClass.toLowerCase().includes("search") ||
        parentId.toLowerCase().includes("search")
      ) {
        context.push("IN_SEARCH_CONTAINER");
        break;
      }

      currentElement = currentElement.parentElement;
      depth++;
    }

    // Combine description and context
    let result = description.join(" ");
    if (context.length > 0) {
      result += ` [${context.join(", ")}]`;
    }

    return result;
  }

  // ===== RECORDING METHODS =====
  recordNavigation() {
    const currentTime = Date.now();
    const delay = currentTime - this.lastActionTime;
    this.lastActionTime = currentTime;

    const action = {
      type: "Navigate",
      url: window.location.href,
      waitConditions: {
        waitForSelector: false,
        waitForVisible: false,
        waitForNavigation: true,
        timeout: 10000,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      delay: delay,
      details: `Navigation to ${window.location.host}${window.location.pathname}`,
      icon: ACTION_ICONS.Navigate,
      timestamp: currentTime,
    };

    this.sendMessage(MESSAGE_TYPES.RECORD_NAVIGATE, action);
  }

  sendMessage(type, payload = null) {
    const message = { type, ...(payload && { payload }) };
    chrome.runtime.sendMessage(message);
  }

  // ===== EVENT HANDLING =====
  attachEventListeners() {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        const rect = target.getBoundingClientRect();
        const currentTime = Date.now();
        const delay = currentTime - this.lastActionTime;
        this.lastActionTime = currentTime;

        const action = {
          type: "Click",
          selector: this.generateSelector(target),
          fallbackSelectors: this.generateFallbackSelectors(target),
          waitConditions: this.getWaitConditions(target),
          coordinates: {
            x: Math.round(event.clientX),
            y: Math.round(event.clientY),
            pageX: Math.round(event.pageX),
            pageY: Math.round(event.pageY),
          },
          elementRect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
          },
          delay: delay,
          details: this.getDetailedElementDescription(target),
          icon: ACTION_ICONS.Click,
          timestamp: currentTime,
        };

        this.sendMessage(MESSAGE_TYPES.RECORD_CLICK, action);
      },
      true
    );

    document.addEventListener(
      "keydown",
      (event) => {
        const currentTime = Date.now();
        const delay = currentTime - this.lastActionTime;
        this.lastActionTime = currentTime;

        if (event.key === "Backspace") {
          this.sendMessage(MESSAGE_TYPES.RECORD_BACKSPACE, {
            delay: delay,
            timestamp: currentTime,
          });
        } else if (event.key.length === 1) {
          const target = event.target;
          const payload = {
            key: event.key,
            targetSelector: target.tagName.toLowerCase(),
            selector: this.generateSelector(target),
            fallbackSelectors: this.generateFallbackSelectors(target),
            waitConditions: this.getWaitConditions(target),
            elementDetails: this.getDetailedElementDescription(target),
            delay: delay,
            timestamp: currentTime,
          };

          this.sendMessage(MESSAGE_TYPES.RECORD_RAW_TYPE, payload);
        }
      },
      true
    );

    let lastScrollTime = 0;
    let scrollTimeout;

    document.addEventListener(
      "scroll",
      () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          const currentTime = Date.now();

          if (currentTime - lastScrollTime > 100) {
            const delay = currentTime - this.lastActionTime;
            this.lastActionTime = currentTime;

            const action = {
              type: "Scroll",
              scrollX: Math.round(window.scrollX),
              scrollY: Math.round(window.scrollY),
              waitConditions: {
                waitForSelector: false,
                waitForVisible: false,
                timeout: 1000,
              },
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
              },
              maxScroll: {
                x: document.documentElement.scrollWidth - window.innerWidth,
                y: document.documentElement.scrollHeight - window.innerHeight,
              },
              delay: delay,
              details: `Scrolled to position (${Math.round(
                window.scrollX
              )}, ${Math.round(window.scrollY)}) on page: ${document.title}`,
              icon: ACTION_ICONS.Scroll,
              timestamp: currentTime,
            };

            this.sendMessage(MESSAGE_TYPES.RECORD_SCROLL, action);
            lastScrollTime = currentTime;
          }
        }, 50);
      },
      { passive: true }
    );
  }
}
