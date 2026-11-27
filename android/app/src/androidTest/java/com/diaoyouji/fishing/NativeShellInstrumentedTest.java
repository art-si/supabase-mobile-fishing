package com.diaoyouji.fishing;

import static org.junit.Assert.*;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Checks the installed Android WebView and plugin bridge, not a desktop H5 preview. */
@RunWith(AndroidJUnit4.class)
public class NativeShellInstrumentedTest {
    @Test
    public void packagedApplicationLoadsWithNativePlugins() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            JSONObject state = new JSONObject();
            for (int attempt = 0; attempt < 60; attempt++) {
                state = inspect(scenario);
                if (state.optInt("textLength") > 20) break;
                Thread.sleep(500);
            }
            assertEquals("android", state.optString("platform"));
            assertEquals("https://localhost", state.optString("origin"));
            assertTrue("Packaged Vue application must render", state.optInt("textLength") > 20);
            assertTrue("Native camera plugin must be registered", state.optBoolean("camera"));
            assertTrue("Native geolocation plugin must be registered", state.optBoolean("location"));
            assertFalse("Live build must not open the local demo", state.optBoolean("demo"));
            assertTrue("Initial screen must fit the WebView", state.optInt("overflow") <= 1);
        }
    }

    private JSONObject inspect(ActivityScenario<MainActivity> scenario) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> response = new AtomicReference<>("null");
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
            "JSON.stringify({platform:window.Capacitor?.getPlatform?.(),origin:location.origin,"
            + "textLength:document.body?.innerText.length||0,"
            + "camera:!!window.Capacitor?.isPluginAvailable?.('Camera'),"
            + "location:!!window.Capacitor?.isPluginAvailable?.('Geolocation'),"
            + "demo:/本机体验|不连接线上/.test(document.body?.innerText||''),"
            + "overflow:document.documentElement.scrollWidth-innerWidth})",
            value -> { response.set(value); done.countDown(); }
        ));
        assertTrue("Android WebView must respond", done.await(10, TimeUnit.SECONDS));
        Object decoded = new JSONTokener(response.get()).nextValue();
        return decoded instanceof String ? new JSONObject((String) decoded) : new JSONObject();
    }
}
