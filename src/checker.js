import { sendToHomematic } from './homematic.js';
import { fetchTodayStatus } from './kitafino/orders.js';
import { buildNotification, buildBalanceNotification, sendNotification } from './notify.js';
import { readState, updateState } from './state.js';

let running = null;

export async function runCheck({ notify = false, config } = {}) {
  if (running) return running;

  running = (async () => {
    const startedAt = new Date().toISOString();

    try {
      const status = await fetchTodayStatus({
        username: config.kitafino.username,
        password: config.kitafino.password,
      });

      updateState({
        lastStatus: status,
        lastRun: { at: startedAt, ok: true, error: null },
      });

      let notification = null;
      if (notify) {
        notification = buildNotification(status);
        try {
          await sendNotification(config.ntfy, notification);
          updateState({
            lastNotification: {
              at: new Date().toISOString(),
              ok: true,
              error: null,
              message: notification.message,
            },
          });
        } catch (err) {
          updateState({
            lastNotification: {
              at: new Date().toISOString(),
              ok: false,
              error: err.message,
              message: notification.message,
            },
          });
          notification = { ...notification, error: err.message };
        }
      }

      if (config.homematic?.enabled && config.homematic?.host) {
        try {
          const hmRes = await sendToHomematic(
            {
              ...config.homematic,
              balanceWatch: config.balanceWatch,
            },
            status,
          );
          updateState({
            lastHomematic: {
              at: new Date().toISOString(),
              ok: true,
              error: null,
              text: hmRes.text,
              variable: hmRes.variableName,
            },
          });
        } catch (err) {
          updateState({
            lastHomematic: {
              at: new Date().toISOString(),
              ok: false,
              error: err.message,
            },
          });
        }
      }

      if (notify && config.balanceWatch?.enabled && config.balanceWatch?.notifyNtfy) {
        const threshold = Number(config.balanceWatch.threshold ?? 10);
        const isLow = Boolean(
          status.account?.lowBalance ||
            (status.account?.balanceAmount !== null &&
              status.account?.balanceAmount < threshold),
        );
        if (isLow) {
          const balNotif = buildBalanceNotification(status.account, threshold);
          try {
            await sendNotification(config.ntfy, balNotif);
            updateState({
              lastBalanceWarning: {
                at: new Date().toISOString(),
                ok: true,
                message: balNotif.message,
              },
            });
          } catch (err) {
            updateState({
              lastBalanceWarning: {
                at: new Date().toISOString(),
                ok: false,
                error: err.message,
              },
            });
          }
        }
      }

      return { ok: true, status, notification };
    } catch (err) {
      const message =
        err.code === 'LOGIN_FAILED'
          ? `Login bei Kitafino fehlgeschlagen: ${err.message}`
          : err.message;

      updateState({ lastRun: { at: startedAt, ok: false, error: message } });
      return { ok: false, error: message, status: readState().lastStatus };
    } finally {
      running = null;
    }
  })();

  return running;
}

export function currentStatus() {
  return readState();
}
