// Partial extension for TucJobBooking - the one column the final-mile tote
// flow needs on the booking.
//
// SEQUENCING, and it matters. This column is created by dbmigrationsv2
// 20261021140000 (M0 of the final-mile tote spec). It does not exist on any
// tenant until that migration applies, and EF will throw on every booking read
// against a tenant without it. So this app build MUST deploy after M0, which
// is the ordinary additive rule: migration first, then the app.
#nullable disable

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucJobBooking
{
    // How the lab takes delivery of a final-mile tote: 1 = accept sealed totes
    // (scan the tote, every shipment inside is delivered), 2 = scan each item
    // out. Spec decision D3: it is a property of the final-mile MASTER, not of
    // a tote or a client, and it rides to the handset on the job message.
    //
    // NOT NULL with a default of 1 in the database, so every existing booking
    // already reads as "accept sealed totes". It is only ever meaningful on a
    // booking that is also a final-mile master (IsLinehaulMaster with a RouteId
    // and no LinehaulRunId); on every other booking it is inert.
    public byte FinalMileDeliveryMode { get; set; }
}
