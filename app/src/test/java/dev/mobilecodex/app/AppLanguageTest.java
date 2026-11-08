package dev.mobilecodex.app;

import android.app.Application;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import dev.mobilecodex.app.core.Texts;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=29, application=Application.class, qualifiers="en")
public class AppLanguageTest {
    @After public void cleanup(){Texts.configure(true,java.util.Map.of());}
    @Test public void KoreanChoiceIsRemovedAndLegacyPreferenceMigratesToEnglish()throws Exception{
        var context=RuntimeEnvironment.getApplication();
        context.getSharedPreferences("appearance",0).edit().clear().commit();
        AppLanguage.initialize(context);
        assertEquals("Settings",Texts.t("설정"));
        AppLanguage.set(context,"en");assertEquals("en",AppLanguage.choice(context));
        assertEquals("Settings",Texts.t("설정"));
        context.getSharedPreferences("appearance",0).edit().putString("language","ko").commit();
        AppLanguage.initialize(context);
        assertEquals("en",AppLanguage.choice(context));
        assertEquals("Settings",Texts.t("설정"));
        assertThrows(IllegalArgumentException.class,()->AppLanguage.set(context,"ko"));
        assertThrows(IllegalArgumentException.class,()->AppLanguage.set(context,"unsupported"));
    }
}
