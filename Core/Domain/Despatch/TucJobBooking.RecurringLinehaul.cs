// Partial extension for TucJobBooking - adds the two columns the Recurring
// Routes Linehaul port needs. Both pre-exist in the shared Despatch DB
// (verified 2026-08-12 via MCP on both tenants).
#nullable disable

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucJobBooking
{
    // The linehaul run this booking has been linked to (STEVE-LINEHAUL-RUN-
    // MODAL-MASTER-JOB). Set by RecurringLinehaulService.ApplyMasterBookingAsync;
    // cleared when the master link is moved to another run.
    public int? LinehaulRunId { get; set; }

    // True when this booking is the "master" linehaul job for the linked run.
    // Only one master is allowed per run (enforced service-side, not by a
    // filtered unique index). NOT NULL in the DB with default 0.
    public bool IsLinehaulMaster { get; set; }

    // Recurring route this booking is bound to (Configurator's "Recurring
    // Routes" feature). Powers the read-only "Bookings on this route" list
    // in the Route editor modal.
    public int? RouteId { get; set; }
}
