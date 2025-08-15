class PopupController {
  constructor() {
    this.actions = [];
    this.isRecording = false;
    this.initializeElements();
    this.attachEventListeners();
    this.initializeState();
  }

  initializeElements() {
    this.elements = {
      recordBtn: document.getElementById("record-btn"),
      recordBtnText: document.getElementById("record-btn-text"),
      recordBtnIcon: document.getElementById("record-btn-icon"),
      saveBtn: document.getElementById("save-btn"),
      statusDot: document.getElementById("status-dot"),
      statusText: document.getElementById("status-text"),
      actionCount: document.getElementById("action-count"),
      emptyList: document.getElementById("empty-actions-list"),
      populatedList: document.getElementById("populated-actions-list"),
      savedRecordingsList: document.getElementById("saved-recordings-list"),
      recordView: document.getElementById("record-view"),
      savedView: document.getElementById("saved-view"),
      recordTabBtn: document.getElementById("record-tab-btn"),
      savedTabBtn: document.getElementById("saved-tab-btn"),
    };
  }

  attachEventListeners() {
    this.elements.recordBtn.addEventListener("click", () =>
      this.sendMessage(MESSAGE_TYPES.TOGGLE_RECORDING)
    );
    this.elements.recordTabBtn.addEventListener("click", () =>
      this.switchView("record")
    );
    this.elements.savedTabBtn.addEventListener("click", () =>
      this.switchView("saved")
    );
    this.elements.saveBtn.addEventListener("click", () =>
      this.handleSaveRecording()
    );
    this.elements.savedRecordingsList.addEventListener("click", (event) =>
      this.handleSavedRecordingAction(event)
    );
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === MESSAGE_TYPES.UPDATE_STATE) {
        this.updateUI(message.payload);
      }
    });
  }

  switchView(viewName) {
    const isRecordView = viewName === "record";
    this.elements.recordView.classList.toggle("hidden", !isRecordView);
    this.elements.savedView.classList.toggle("hidden", isRecordView);
    this.elements.recordTabBtn.classList.toggle("active", isRecordView);
    this.elements.savedTabBtn.classList.toggle("active", !isRecordView);
    if (!isRecordView) {
      this.loadSavedRecordings();
    }
  }

  updateUI(state) {
    this.actions = state?.actions || [];
    this.isRecording = state?.isRecording || false;
    this.updateRecordingButton(state?.isRecording);
    this.updateStatus(state?.isRecording);
    this.renderActions();
  }

  updateRecordingButton(isRecording) {
    const { recordBtn, recordBtnText, recordBtnIcon } = this.elements;
    recordBtnText.textContent = isRecording
      ? "Stop Recording"
      : "Start Recording";
    recordBtnIcon.src = `../icons/${isRecording ? "stop" : "circle"}.png`;
    if (isRecording) {
      recordBtn.classList.remove("btn-start");
      recordBtn.classList.add("btn-stop");
    } else {
      recordBtn.classList.remove("btn-stop");
      recordBtn.classList.add("btn-start");
    }
  }

  updateStatus(isRecording) {
    const { statusDot, statusText } = this.elements;
    statusDot.className = isRecording
      ? "w-3 h-3 bg-emerald-400 animate-pulse rounded-full"
      : "w-3 h-3 bg-slate-300 rounded-full";
    statusText.textContent = isRecording ? "Recording..." : "Ready to record";
  }

  renderActions() {
    const { populatedList, emptyList, actionCount, saveBtn } = this.elements;
    populatedList.innerHTML = "";
    if (this.actions.length > 0) {
      emptyList.classList.add("hidden");
      populatedList.classList.remove("hidden");
      this.actions.forEach((action) => {
        const actionElement = this.createActionElement(action);
        populatedList.appendChild(actionElement);
      });
    } else {
      emptyList.classList.remove("hidden");
      populatedList.classList.add("hidden");
    }
    actionCount.textContent = this.actions.length;
    const canSave = this.actions.length > 0 && !this.isRecording;
    saveBtn.disabled = !canSave;
    saveBtn.style.opacity = canSave ? 1 : 0.5;
  }

  createActionElement(action) {
    const template = document
      .getElementById("action-item-template")
      .content.cloneNode(true);
    const item = template.querySelector(".action-item");
    item.querySelector(".action-title").textContent = action.type;
    item.querySelector(".action-details").textContent = action.details;
    item.querySelector("img").src = `../icons/${action.icon}.png`;
    return item;
  }

  loadSavedRecordings() {
    this.sendMessage(MESSAGE_TYPES.GET_SAVED_RECORDINGS, null, (recordings) => {
      this.renderSavedRecordings(recordings);
    });
  }

  renderSavedRecordings(recordings) {
    const { savedRecordingsList } = this.elements;
    savedRecordingsList.innerHTML = "";
    if (recordings?.length > 0) {
      recordings.forEach((recording) => {
        const recordingElement = this.createSavedRecordingElement(recording);
        savedRecordingsList.appendChild(recordingElement);
      });
    } else {
      savedRecordingsList.innerHTML = `
        <div class="text-center py-8 text-slate-500">
          <p class="text-sm">No saved recordings</p>
          <p class="text-xs mt-1">Record some actions to get started</p>
        </div>
      `;
    }
  }

  createSavedRecordingElement(recording) {
    const recordingDiv = document.createElement("div");
    recordingDiv.className =
      "bg-white border border-slate-200 rounded-lg p-4 mb-3";
    recordingDiv.innerHTML = `
      <div class="flex justify-between items-start mb-3">
        <div class="flex-1">
          <h3 class="font-medium text-slate-900 text-sm">${recording.name}</h3>
          <p class="text-xs text-slate-500 mt-1">${
            recording.actions?.length || 0
          } actions • ${new Date(recording.date).toLocaleDateString()}</p>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="download-btn flex-1 bg-emerald-200 hover:bg-emerald-100 border-emerald-300 text-emerald-800 text-xs font-medium py-2 px-3 rounded-md transition-colors duration-200 flex items-center justify-center gap-1" data-id="${
          recording.id
        }">
          <img src="../icons/download.png" alt="" class="w-4 h-4 invert">
          <span>Download</span>
        </button>
        <button class="delete-btn bg-rose-200 hover:bg-rose-100 border-rose-300 text-rose-800 text-xs font-medium py-2 px-3 rounded-md transition-colors duration-200 flex items-center justify-center gap-1" data-id="${
          recording.id
        }">
          <img src="../icons/delete.png" alt="" class="w-4 h-4 invert">
          <span>Delete</span>
        </button>
      </div>
    `;
    return recordingDiv;
  }

  handleSavedRecordingAction(event) {
    const button = event.target.closest("button");
    if (!button) return;

    const recordingId = button.dataset.id;
    if (!recordingId) return;

    if (button.classList.contains("download-btn")) {
      this.sendMessage(MESSAGE_TYPES.DOWNLOAD_RECORDING, { id: recordingId });
    } else if (button.classList.contains("delete-btn")) {
      if (confirm("Are you sure you want to delete this recording?")) {
        this.sendMessage(
          MESSAGE_TYPES.DELETE_RECORDING,
          { id: recordingId },
          () => {
            this.loadSavedRecordings();
          }
        );
      }
    }
  }

  handleSaveRecording() {
    const name = prompt("Enter a name for this recording:");
    if (name && name.trim()) {
      this.sendMessage(MESSAGE_TYPES.SAVE_RECORDING, { name: name.trim() });
    }
  }

  async initializeState() {
    chrome.storage.local.get(["EXTENSION_CONSTANTS"], (result) => {
      if (result.EXTENSION_CONSTANTS) {
        window.MESSAGE_TYPES = result.EXTENSION_CONSTANTS.MESSAGE_TYPES;
        this.sendMessage(MESSAGE_TYPES.GET_STATE, null, (state) => {
          this.updateUI(state);
        });
      }
    });
  }

  sendMessage(type, payload = null, callback = null) {
    const message = { type, ...(payload && { payload }) };
    if (callback) {
      chrome.runtime.sendMessage(message, callback);
    } else {
      chrome.runtime.sendMessage(message);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new PopupController();
});
