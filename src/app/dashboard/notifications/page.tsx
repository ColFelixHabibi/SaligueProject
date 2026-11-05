
'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { ask } from '@/components/confirm-dialog';
import { cn } from '@/lib/utils';
import { Bell, BellOff, CheckCheck, MessageSquare, Package, ShoppingCart, Trash2, User } from 'lucide-react';
import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useNotificationStore, Notification } from '@/hooks/use-notification-store';
import { useDashboardSearchStore } from '@/hooks/use-dashboard-search-store';
import { useToast } from '@/hooks/use-toast';


const getIconForType = (type: string) => {
    switch (type) {
        case 'order':
            return <Package className="h-6 w-6 text-primary" />;
        case 'sale':
            return <ShoppingCart className="h-6 w-6 text-green-500" />;
        case 'message':
             return <MessageSquare className="h-6 w-6 text-blue-500" />;
        case 'review':
             return <User className="h-6 w-6 text-yellow-500" />;
        case 'account':
             return <User className="h-6 w-6 text-purple-500" />;
        case 'product':
             return <Package className="h-6 w-6 text-orange-500" />;
        default:
            return <Bell className="h-6 w-6 text-muted-foreground" />;
    }
}


export default function NotificationsPage() {
    const { notifications, markAsRead, markAllAsRead, remove, clearAll } = useNotificationStore();
    const { toast } = useToast();
    const router = useRouter();
    const { searchQuery } = useDashboardSearchStore();

    const filteredNotifications = useMemo(() => {
        if (!searchQuery) {
            return notifications;
        }
        return notifications.filter(notification =>
            notification.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            notification.description.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [searchQuery, notifications]);


    const handleNotificationClick = (notification: Notification) => {
        markAsRead(notification.id);
        if (notification.link) {
            router.push(notification.link);
        }
    };

    // Clearing asks first: it is one tap away by accident and there is no undo.
    const clearAllNow = async () => {
        const answer = await ask({
            title: 'Clear all notifications?',
            description: 'They are removed from this account only. Your orders, chats and money are not touched.',
            confirm: 'Delete',
            destructive: true,
        });
        if (!answer) return;
        clearAll();
        toast({ title: 'Notifications cleared' });
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="hidden text-2xl font-bold tracking-tight md:block">Notifications</h1>
                    <p className="text-muted-foreground">Manage your account and sales notifications.</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={markAllAsRead} disabled={!notifications.length} title="Mark all as read">
                        <CheckCheck className="mr-2 h-4 w-4" />
                        Mark all as read
                    </Button>
                    <Button variant="outline" onClick={() => void clearAllNow()} disabled={!notifications.length} className="text-destructive hover:text-destructive" title="Delete every notification">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Clear all
                    </Button>
                </div>
            </div>
            <Card>
                <CardContent className="p-0">
                    <div className="divide-y divide-border">
                        {filteredNotifications.length > 0 ? (
                            filteredNotifications.map((notification) => (
                                <div 
                                    key={notification.id} 
                                    className={cn(
                                        "flex items-start gap-4 p-4 transition-colors cursor-pointer hover:bg-muted/50",
                                        !notification.read && "bg-primary/5"
                                    )}
                                    onClick={() => handleNotificationClick(notification)}
                                >
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted flex-shrink-0">
                                        {getIconForType(notification.type)}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-center">
                                            <p className="font-semibold">{notification.title}</p>
                                            <p className="text-xs text-muted-foreground">{notification.time}</p>
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                                            {notification.description}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-center gap-2 self-center">
                                        {!notification.read && (
                                            <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-label="Unread" />
                                        )}
                                        {/* Remove this one: the little bin stops here, it does not open the notification. */}
                                        <button
                                            type="button"
                                            aria-label="Delete this notification"
                                            title="Delete"
                                            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                                            onClick={(event) => { event.stopPropagation(); remove(notification.id); }}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="flex flex-col items-center gap-2 py-12 text-center">
                                <BellOff className="h-9 w-9 text-muted-foreground" />
                                <p className="text-muted-foreground">{notifications.length ? 'No notifications match your search.' : 'No notifications yet. New orders, messages and account news will appear here.'}</p>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
