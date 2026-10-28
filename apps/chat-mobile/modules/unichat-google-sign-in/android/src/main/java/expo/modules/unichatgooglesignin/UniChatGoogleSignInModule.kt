package expo.modules.unichatgooglesignin

import android.content.Context
import android.content.pm.PackageManager
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Sign in with Google for UniChat (ADR 0047 §8): Credential Manager's "Sign in with Google" option, with the nonce the
 * server checks, so the ID token carries it. The server client id (the web client, the token's audience) is the app's
 * own meta-data, written by plugins/with-google-sign-in.js; a build without it, or a phone without Google Play
 * services, reports unavailable and the app goes through the browser.
 */
class UniChatGoogleSignInModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("UniChatGoogleSignIn")

    AsyncFunction("isAvailable") {
      val context = appContext.reactContext
      context != null &&
        serverClientId(context) != null &&
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }

    AsyncFunction("signIn") Coroutine { nonce: String ->
      val activity = appContext.currentActivity
        ?: throw CodedException("ERR_GOOGLE_NO_PRESENTER", "no screen to present Google's sign-in on", null)
      val clientId = serverClientId(activity)
        ?: throw CodedException("ERR_GOOGLE_NOT_CONFIGURED", "this build carries no Google client id", null)
      val option = GetSignInWithGoogleOption.Builder(clientId).setNonce(nonce).build()
      val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
      try {
        val credential = CredentialManager.create(activity).getCredential(activity, request).credential
        if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
          throw CodedException("ERR_GOOGLE_NO_TOKEN", "Google returned no ID token", null)
        }
        val google = GoogleIdTokenCredential.createFrom(credential.data)
        mapOf("idToken" to google.idToken, "email" to google.id)
      } catch (cancelled: GetCredentialCancellationException) {
        // The person closed the sheet: nothing to say.
        null
      } catch (failure: GetCredentialException) {
        throw CodedException("ERR_GOOGLE_SIGN_IN", failure.message, failure)
      } catch (failure: GoogleIdTokenParsingException) {
        throw CodedException("ERR_GOOGLE_NO_TOKEN", failure.message, failure)
      }
    }

    // The explicit `->` picks Coroutine's zero-argument overload, as Expo's own modules write it; ktlint's
    // function-literal rule would drop it and leave the call ambiguous between the overloads.
    @Suppress("ktlint:standard:function-literal")
    AsyncFunction("signOut") Coroutine { ->
      appContext.reactContext?.let { context ->
        CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest())
      }
      Unit
    }
  }

  private fun serverClientId(context: Context): String? {
    val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
    return info.metaData?.getString(SERVER_CLIENT_ID)?.takeIf { it.isNotBlank() }
  }

  companion object {
    /** The manifest meta-data plugins/with-google-sign-in.js writes. */
    const val SERVER_CLIENT_ID = "expo.modules.unichatgooglesignin.SERVER_CLIENT_ID"
  }
}
