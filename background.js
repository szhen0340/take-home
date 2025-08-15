chrome.storage.local.set({
  EXTENSION_CONSTANTS: {
    MESSAGE_TYPES: {
      TOGGLE_RECORDING: "TOGGLE_RECORDING",
      GET_STATE: "GET_STATE",
      UPDATE_STATE: "UPDATE_STATE",
      RECORD_NAVIGATE: "RECORD_NAVIGATE",
      RECORD_CLICK: "RECORD_CLICK",
      RECORD_RAW_TYPE: "RECORD_RAW_TYPE",
      RECORD_BACKSPACE: "RECORD_BACKSPACE",
      RECORD_SCROLL: "RECORD_SCROLL",
      SAVE_RECORDING: "SAVE_RECORDING",
      GET_SAVED_RECORDINGS: "GET_SAVED_RECORDINGS",
      DELETE_RECORDING: "DELETE_RECORDING",
      DOWNLOAD_RECORDING: "DOWNLOAD_RECORDING",
    },
    CONFIG: {
      TYPING_TIMEOUT: 1000,
      STORAGE_KEY: "recordings",
    },
    ACTION_ICONS: {
      Navigate: "navigate",
      Click: "click",
      Type: "keyboard",
      Scroll: "scroll",
    },
  },
});

chrome.storage.local.get(["EXTENSION_CONSTANTS"], (result) => {
  if (result.EXTENSION_CONSTANTS) {
    MESSAGE_TYPES = result.EXTENSION_CONSTANTS.MESSAGE_TYPES;
    CONFIG = result.EXTENSION_CONSTANTS.CONFIG;
    ACTION_ICONS = result.EXTENSION_CONSTANTS.ACTION_ICONS;
    new RecordingManager();
  }
});

class RecordingManager {
  // ===== INITIALIZATION & SETUP =====
  constructor() {
    this.state = {
      isRecording: false,
      actions: [],
      tabId: null,
    };
    this.typingState = {
      timer: null,
      currentString: "",
      target: null,
      selector: null,
    };
    this.initializeListeners();
  }

  initializeListeners() {
    chrome.tabs.onActivated.addListener((activeInfo) => {
      if (this.state.isRecording && activeInfo.tabId !== this.state.tabId) {
        this.stopRecording();
      }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        return this.handleMessage(message, sender, sendResponse);
      } catch (error) {
        console.error("Error in message handler:", error);
        sendResponse({ success: false, error: error.message });
        return true;
      }
    });
  }

  async getActiveTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab;
  }

  // ===== RECORDING CONTROL =====
  async startRecording() {
    const tab = await this.getActiveTab();
    if (!tab || tab.url?.startsWith("chrome://")) return;

    this.state.isRecording = true;
    this.state.actions = [];
    this.state.tabId = tab.id;

    const navAction = {
      type: "Navigate",
      value: tab.url,
      details: `to ${new URL(tab.url).host}`,
      icon: ACTION_ICONS.Navigate,
    };
    this.state.actions.push(navAction);

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch (error) {
      console.log(
        "Content script already injected or injection failed:",
        error
      );
    }

    this.updatePopup();
  }

  stopRecording() {
    this.finalizeTypingAction();
    this.state.isRecording = false;
    this.state.tabId = null;
    this.updatePopup();
  }

  updatePopup() {
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.UPDATE_STATE,
      payload: this.state,
    });
  }

  // ===== TYPING STATE MANAGEMENT =====
  finalizeTypingAction() {
    if (this.typingState.currentString) {
      this.state.actions.push({
        type: "Type",
        selector: this.typingState.selector,
        value: this.typingState.currentString,
        details: `"${this.typingState.currentString}"`,
        icon: ACTION_ICONS.Type,
      });
      this.updatePopup();
    }
    this.resetTypingState();
  }

  resetTypingState() {
    clearTimeout(this.typingState.timer);
    this.typingState = {
      timer: null,
      currentString: "",
      target: null,
      selector: null,
    };
  }

  // ===== MESSAGE HANDLING =====
  handleMessage(message, sender, sendResponse) {
    const isControlMessage = this.isControlMessage(message.type);

    if (!this.state.isRecording && !isControlMessage) {
      sendResponse({ success: false, error: "Not recording" });
      return true;
    }

    if (
      this.state.isRecording &&
      sender.tab &&
      sender.tab.id !== this.state.tabId
    ) {
      sendResponse({ success: false, error: "Wrong tab" });
      return true;
    }

    const handler = this.getMessageHandler(message.type);
    if (handler) {
      return handler.call(this, message, sendResponse);
    }

    sendResponse({ success: false, error: "Unknown message type" });
    return true;
  }

  isControlMessage(type) {
    return [
      MESSAGE_TYPES.GET_STATE,
      MESSAGE_TYPES.TOGGLE_RECORDING,
      MESSAGE_TYPES.SAVE_RECORDING,
      MESSAGE_TYPES.GET_SAVED_RECORDINGS,
      MESSAGE_TYPES.DELETE_RECORDING,
      MESSAGE_TYPES.DOWNLOAD_RECORDING,
    ].includes(type);
  }

  getMessageHandler(type) {
    const handlers = {
      [MESSAGE_TYPES.TOGGLE_RECORDING]: this.handleToggleRecording,
      [MESSAGE_TYPES.GET_STATE]: this.handleGetState,
      [MESSAGE_TYPES.RECORD_NAVIGATE]: this.handleRecordAction,
      [MESSAGE_TYPES.RECORD_CLICK]: this.handleRecordAction,
      [MESSAGE_TYPES.RECORD_SCROLL]: this.handleRecordAction,
      [MESSAGE_TYPES.RECORD_RAW_TYPE]: this.handleRecordRawType,
      [MESSAGE_TYPES.RECORD_BACKSPACE]: this.handleRecordBackspace,
      [MESSAGE_TYPES.SAVE_RECORDING]: this.handleSaveRecording,
      [MESSAGE_TYPES.GET_SAVED_RECORDINGS]: this.handleGetSavedRecordings,
      [MESSAGE_TYPES.DELETE_RECORDING]: this.handleDeleteRecording,
      [MESSAGE_TYPES.DOWNLOAD_RECORDING]: this.handleDownloadRecording,
    };
    return handlers[type];
  }

  // ===== RECORDING ACTION HANDLERS =====
  handleToggleRecording(message, sendResponse) {
    if (this.state.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
    sendResponse({ success: true });
    return true;
  }

  handleGetState(message, sendResponse) {
    sendResponse(
      this.state || { isRecording: false, actions: [], tabId: null }
    );
    return true;
  }

  handleRecordAction(message, sendResponse) {
    this.finalizeTypingAction();
    this.state.actions.push(message.payload);
    this.updatePopup();
    sendResponse({ success: true });
    return true;
  }

  handleRecordRawType(message, sendResponse) {
    const { key, targetSelector, selector } = message.payload;

    if (this.typingState.target && this.typingState.target !== targetSelector) {
      this.finalizeTypingAction();
    }

    this.typingState.target = targetSelector;
    this.typingState.selector = selector;
    this.typingState.currentString += key;

    clearTimeout(this.typingState.timer);
    this.typingState.timer = setTimeout(
      () => this.finalizeTypingAction(),
      CONFIG.TYPING_TIMEOUT
    );

    sendResponse({ success: true });
    return true;
  }

  handleRecordBackspace(message, sendResponse) {
    if (this.typingState.currentString.length > 0) {
      this.typingState.currentString = this.typingState.currentString.slice(
        0,
        -1
      );
    }

    clearTimeout(this.typingState.timer);
    this.typingState.timer = setTimeout(
      () => this.finalizeTypingAction(),
      CONFIG.TYPING_TIMEOUT
    );

    sendResponse({ success: true });
    return true;
  }

  // ===== STORAGE OPERATIONS =====
  handleSaveRecording(message, sendResponse) {
    chrome.storage.local.get({ [CONFIG.STORAGE_KEY]: [] }, (data) => {
      const newRecording = {
        id: `rec_${Date.now()}`,
        name: message.payload.name,
        actions: this.state.actions,
        date: new Date().toISOString(),
      };

      const updatedRecordings = [newRecording, ...data[CONFIG.STORAGE_KEY]];

      chrome.storage.local.set(
        { [CONFIG.STORAGE_KEY]: updatedRecordings },
        () => {
          this.state.actions = [];
          this.updatePopup();
          sendResponse({ success: true });
        }
      );
    });
    return true;
  }

  handleGetSavedRecordings(message, sendResponse) {
    chrome.storage.local.get({ [CONFIG.STORAGE_KEY]: [] }, (data) => {
      sendResponse(data[CONFIG.STORAGE_KEY]);
    });
    return true;
  }

  handleDeleteRecording(message, sendResponse) {
    chrome.storage.local.get({ [CONFIG.STORAGE_KEY]: [] }, (data) => {
      const filteredRecordings = data[CONFIG.STORAGE_KEY].filter(
        (rec) => rec.id !== message.payload.id
      );

      chrome.storage.local.set(
        { [CONFIG.STORAGE_KEY]: filteredRecordings },
        () => {
          sendResponse({ success: true });
        }
      );
    });
    return true;
  }

  handleDownloadRecording(message, sendResponse) {
    chrome.storage.local.get({ [CONFIG.STORAGE_KEY]: [] }, (data) => {
      const recording = data[CONFIG.STORAGE_KEY].find(
        (rec) => rec.id === message.payload.id
      );

      if (recording) {
        const jsonContent = JSON.stringify(recording, null, 2);
        const dataUrl =
          "data:application/json;charset=utf-8," +
          encodeURIComponent(jsonContent);

        const filename = `${recording.name.replace(/[^a-z0-9]/gi, "_")}_${
          recording.id
        }.json`;

        chrome.downloads.download(
          {
            url: dataUrl,
            filename: filename,
            saveAs: true,
          },
          (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error("Download failed:", chrome.runtime.lastError);
              sendResponse({
                success: false,
                error: chrome.runtime.lastError.message,
              });
            } else {
              console.log("Download started with ID:", downloadId);
              sendResponse({ success: true });
            }
          }
        );
      } else {
        sendResponse({ success: false, error: "Recording not found" });
      }
    });
    return true;
  }
}
