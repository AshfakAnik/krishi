import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../core/session';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Icon } from '../../shared/ui/icon';

/** Always shows the same success message on submit, whatever the backend
 *  says — AuthService.requestPasswordReset never reveals whether the email
 *  matched an account, so there is nothing more specific to show here. */
@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink, Alert, FormField, Icon],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPassword {
  private readonly session = inject(SessionService);
  private readonly builder = inject(FormBuilder);

  protected readonly attempted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  protected readonly done = signal(false);

  protected readonly form = this.builder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected errorFor(field: 'email'): string {
    if (!this.attempted()) {
      return '';
    }
    if (this.form.controls[field].hasError('required')) {
      return 'Required.';
    }
    if (this.form.controls[field].hasError('email')) {
      return 'Enter a valid email address.';
    }
    return '';
  }

  protected submit(): void {
    this.attempted.set(true);
    if (this.form.invalid || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.session.requestPasswordReset(this.form.getRawValue().email).subscribe({
      next: () => {
        this.submitting.set(false);
        this.done.set(true);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set(
          err instanceof HttpErrorResponse
            ? ((err.error as { message?: string } | null)?.message ?? 'Something went wrong.')
            : 'Something went wrong.',
        );
      },
    });
  }
}
