import asyncio
import json
import subprocess
import sys
import time
import os
from playwright.async_api import async_playwright

def find_chrome_executable():
    """Find Chrome executable on Windows"""
    possible_paths = [
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%USERPROFILE%\AppData\Local\Google\Chrome\Application\chrome.exe"),
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            print(f"✅ Found Chrome at: {path}")
            return path
    
    return None

async def connect_to_existing_browser(action_trace_path, debug_port=9222):
    """Connect to existing browser and replay actions"""
    
    # Load action trace
    try:
        with open(action_trace_path, "r") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"❌ Action trace file not found: {action_trace_path}")
        return
    except json.JSONDecodeError:
        print(f"❌ Invalid JSON in trace file: {action_trace_path}")
        return
    
    actions = data.get("actions", [])
    if not actions:
        print("❌ No actions found in trace file.")
        return

    async with async_playwright() as p:
        browser = None
        try:
            # Try to connect to existing browser first
            print(f"🔗 Trying to connect to existing browser on port {debug_port}...")
            browser = await p.chromium.connect_over_cdp(f"http://localhost:{debug_port}")
            print("✅ Connected to existing browser!")
            
        except Exception as e:
            print(f"⚠️ Could not connect to existing browser: {e}")
            
            # Ask if user wants to launch Chrome with debugging
            launch = input("Would you like me to launch Chrome with debugging enabled? (y/n): ").lower().strip()
            
            if launch != 'y':
                print("Please manually start Chrome with debugging enabled:")
                print('chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\\temp\\chrome-debug"')
                return
            
            chrome_path = find_chrome_executable()
            if not chrome_path:
                print("❌ Chrome not found. Please install Chrome or provide the path manually.")
                return
            
            # Launch Chrome with debugging
            cmd = [
                chrome_path,
                "--remote-debugging-port=9222",
                "--user-data-dir=C:\\temp\\chrome-debug"
            ]
            
            print("🚀 Launching Chrome with debugging enabled...")
            subprocess.Popen(cmd)
            time.sleep(4)  # Wait for Chrome to start
            
            # Try to connect again
            try:
                browser = await p.chromium.connect_over_cdp(f"http://localhost:{debug_port}")
                print("✅ Connected to launched browser!")
            except Exception as e2:
                print(f"❌ Still couldn't connect: {e2}")
                return

        # Get page correctly - this fixes the error
        contexts = browser.contexts
        if not contexts:
            # Create new context if none exist
            context = await browser.new_context()
            page = await context.new_page()
            print("📱 Created new context and page")
        else:
            context = contexts[0]  # Get first context
            pages = context.pages   # This is a LIST of pages
            
            if not pages:
                # Create new page if none exist in context
                page = await context.new_page()
                print("📱 Created new page in existing context")
            else:
                page = pages[0]  # Get FIRST PAGE from the list - this is the fix!
                print("📱 Using existing page")

        # Now page is a single Page object, not a list
        # Set viewport from action trace
        first_action_with_viewport = next((a for a in actions if a.get("viewport")), None)
        if first_action_with_viewport and first_action_with_viewport.get("viewport"):
            viewport = first_action_with_viewport["viewport"]
            # This will now work because page is a Page object, not a list
            await page.set_viewport_size({
                "width": viewport["width"],
                "height": viewport["height"]
            })
            print(f"📐 Set viewport to {viewport['width']}x{viewport['height']}")

        print(f"🎬 Starting replay of {len(actions)} actions...")

        for i, action in enumerate(actions):
            print(f"[{i+1}/{len(actions)}] {action.get('type', 'Unknown')}")

            # Apply recorded delays
            delay = action.get("delay", 0)
            if delay > 0:
                await asyncio.sleep(delay / 1000)

            action_type = action.get("type")

            try:
                if action_type == "Navigate":
                    url = action.get("value")
                    print(f"  🌐 Navigating to: {url}")
                    await page.goto(url, wait_until="networkidle", timeout=30000)

                elif action_type == "Click":
                    selector = action.get("selector")
                    fallback_selectors = action.get("fallbackSelectors", [])

                    clicked = False
                    if selector:
                        try:
                            await page.wait_for_selector(selector, timeout=5000)
                            await page.click(selector)
                            print(f"  👆 Clicked: {selector}")
                            clicked = True
                        except Exception:
                            print(f"  ⚠️ Primary selector failed: {selector}")

                    # Try fallback selectors
                    if not clicked and fallback_selectors:
                        for fallback in fallback_selectors:
                            try:
                                if ":contains(" in fallback:
                                    continue
                                await page.wait_for_selector(fallback, timeout=2000)
                                await page.click(fallback)
                                print(f"  👆 Clicked fallback: {fallback}")
                                clicked = True
                                break
                            except Exception:
                                continue

                    # Try coordinates as last resort
                    if not clicked and action.get("coordinates"):
                        coords = action["coordinates"]
                        try:
                            await page.mouse.click(coords["x"], coords["y"])
                            print(f"  👆 Clicked at: ({coords['x']}, {coords['y']})")
                            clicked = True
                        except Exception as e:
                            print(f"  ❌ Coordinate click failed: {e}")

                    if not clicked:
                        print(f"  ⚠️ Could not click element")

                elif action_type == "Type":
                    selector = action.get("selector")
                    text = action.get("value", "")

                    if selector and text:
                        try:
                            await page.wait_for_selector(selector, timeout=5000)
                            await page.fill(selector, "")  # Clear first
                            await page.type(selector, text, delay=50)
                            print(f"  ⌨️ Typed: '{text}'")
                        except Exception as e:
                            print(f"  ❌ Typing failed: {e}")
                            try:
                                await page.keyboard.type(text, delay=50)
                                print(f"  ⌨️ Typed to active element: '{text}'")
                            except Exception:
                                print(f"  ❌ Fallback typing failed")

                elif action_type == "Backspace":
                    await page.keyboard.press("Backspace")
                    print("  ⌫ Pressed Backspace")

                elif action_type == "Scroll":
                    scroll_x = action.get("scrollX", 0)
                    scroll_y = action.get("scrollY", 0)
                    await page.evaluate(f"window.scrollTo({scroll_x}, {scroll_y})")
                    print(f"  📜 Scrolled to: ({scroll_x}, {scroll_y})")

                else:
                    print(f"  ❓ Unsupported: {action_type}")

            except Exception as e:
                print(f"  ❌ Error: {e}")
                continue

            # Small pause for visibility
            await asyncio.sleep(0.5)

        print("\n🎉 Replay completed successfully!")
        print("🖥️ Your browser will continue running normally.")

def main():
    """Main entry point"""
    action_trace_path = sys.argv[1] if len(sys.argv) > 1 else "action_trace.json"
    
    print("🚀 Browser Action Replay")
    print("=" * 30)
    
    try:
        asyncio.run(connect_to_existing_browser(action_trace_path))
    except KeyboardInterrupt:
        print("\n👋 Interrupted by user")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()
