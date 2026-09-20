# Configurable Queue Clicker

A browser userscript that repeatedly clicks a configured trigger until a configured success control appears.

## Features

- Configurable site URL pattern
- Configurable trigger text
- Configurable success text
- Click interval in seconds
- Optional click jitter
- Optional automatic page refresh
- Automatic resume after page refresh
- Click counter and activity log
- Draggable control panel
- Dismissible success popup
- Spoken success message and audible alert
- Stops click and refresh timers when success text appears

## Installation

1. Install the OrangeMonkey browser extension.
2. Open OrangeMonkey.
3. Create a new userscript.
4. Open the `configurable-queue-clicker.user.js` file in this repository.
5. Copy the entire file.
6. Paste it into the OrangeMonkey script editor.
7. Save the userscript.
8. Open the target website.
9. Configure the settings in the panel.
10. Click `Enable/Test Audio`.
11. Click `Start`.

## Configuration

| Field | Purpose | Example |
|---|---|---|
| Site URL Pattern | URL pattern where the script is permitted to run | `https://example.com/events/*` |
| Trigger Text | Visible text of the control that the script should repeatedly click | `Join Queue` |
| Success Text | Visible text that confirms success and stops the script | `Leave Queue` |
| Click Timer | Base seconds between click attempts | `1` |
| Jitter | Random plus/minus seconds added to each click delay | `0.5` |
| Refresh Page Automatically | Enables periodic page reloads | Enabled |
| Page Refresh Timer | Seconds between page reloads | `30` |

## Usage

1. Navigate to the intended webpage.
2. Set the Site URL Pattern.
3. Set the Trigger Text.
4. Set the Success Text.
5. Configure the click timer.
6. Optionally set jitter.
7. Optionally enable automatic page refresh.
8. Click `Enable/Test Audio`.
9. Click `Start`.
10. When the configured Success Text appears, the script stops all timers, displays a dismissible popup, and plays a spoken/audio success alert.

## Example

| Setting | Value |
|---|---|
| Site URL Pattern | `https://site/campaigns/*` |
| Trigger Text | `Join Queue` |
| Success Text | `Leave Queue` |
| Click Timer | `1` | (in seconds)
| Jitter | `0` | (in seconds)
| Refresh Page Automatically | Enabled |
| Page Refresh Timer | `30` |

## License

MIT
